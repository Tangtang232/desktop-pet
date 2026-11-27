// 桌面层（Windows）：宠物窗口钉在桌面（有图标的那个窗口）正上方——平时在所有程序窗口下面、桌面图标上面；
// 按 Win+D 显示桌面时，系统会把桌面窗口提到前面，狗跟着上去，和图标一起露出来。
// 原来的做法是压到所有窗口最底下，Win+D 时就被提上来的桌面盖住了。
// 宠物窗口待在所有程序窗口下面、桌面图标上面，
// 并判断狗、鼠标是不是被别的窗口盖住了（盖住时页面停止绘制、不响应鼠标）。
// 用 koffi 直接调 user32 / dwmapi；加载失败（或不是 Windows）时返回 null，调用方退回普通窗口。
const { screen } = require('electron');

const HWND_TOP = 0, HWND_BOTTOM = 1;
const WS_EX_TOPMOST = 0x08;
const SWP_FLAGS = 0x0001 | 0x0002 | 0x0010 | 0x0200;   // 不改大小、不挪位置、不激活、不动所属窗口
const GW_HWNDNEXT = 2, GW_HWNDPREV = 3, GA_ROOT = 2;
const GWL_STYLE = -16, GWL_EXSTYLE = -20;
const WS_CAPTION = 0x00C00000;
const WS_EX_TRANSPARENT = 0x20, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;

// 系统函数只加载一次：koffi 的结构体名字在一个进程里不能重复定义，第二次 create 时直接复用
let apiCache = null;
function loadApi() {
  if (apiCache) return apiCache;
  let api;
  {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll'), dwmapi = koffi.load('dwmapi.dll');
    const RECT = koffi.struct('PET_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    const POINT = koffi.struct('PET_POINT', { x: 'int32_t', y: 'int32_t' });
    api = {
      SetWindowPos: user32.func('SetWindowPos', 'bool', ['intptr_t', 'intptr_t', 'int', 'int', 'int', 'int', 'uint32_t']),
      GetWindow: user32.func('GetWindow', 'intptr_t', ['intptr_t', 'uint32_t']),
      IsWindowVisible: user32.func('IsWindowVisible', 'bool', ['intptr_t']),
      IsIconic: user32.func('IsIconic', 'bool', ['intptr_t']),
      GetWindowLongPtrW: user32.func('GetWindowLongPtrW', 'intptr_t', ['intptr_t', 'int']),
      GetWindowRect: user32.func('GetWindowRect', 'bool', ['intptr_t', koffi.out(koffi.pointer(RECT))]),
      DwmRect: dwmapi.func('DwmGetWindowAttribute', 'long', ['intptr_t', 'uint32_t', koffi.out(koffi.pointer(RECT)), 'uint32_t']),
      DwmInt: dwmapi.func('DwmGetWindowAttribute', 'long', ['intptr_t', 'uint32_t', koffi.out(koffi.pointer('int32_t')), 'uint32_t']),
      GetAsyncKeyState: user32.func('GetAsyncKeyState', 'int16_t', ['int']),
      FindWindowW: user32.func('FindWindowW', 'intptr_t', ['str16', 'str16']),
      FindWindowExW: user32.func('FindWindowExW', 'intptr_t', ['intptr_t', 'intptr_t', 'str16', 'str16']),
      IsWindow: user32.func('IsWindow', 'bool', ['intptr_t']),
      GetSystemMetrics: user32.func('GetSystemMetrics', 'int', ['int']),
      WindowFromPoint: user32.func('WindowFromPoint', 'intptr_t', [POINT]),
      GetAncestor: user32.func('GetAncestor', 'intptr_t', ['intptr_t', 'uint32_t']),
      GetClassNameW: user32.func('GetClassNameW', 'int', ['intptr_t', 'void *', 'int'])
    };
  }
  return (apiCache = api);
}

function create(win) {
  if (process.platform !== 'win32') return null;
  let api;
  try { api = loadApi(); }
  catch (err) {
    console.error('[desktop-layer] 加载 koffi 失败，宠物会退回普通窗口层级:', err.message);
    return null;
  }

  const hwnd = () => {
    const b = win.getNativeWindowHandle();
    return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
  };

  // 桌面窗口：里面装着桌面图标（SHELLDLL_DefView）的那个。一般是 Progman，换过壁纸、开过某些桌面工具后可能是某个 WorkerW。
  // 找到后记住，失效（资源管理器重启）或者图标挪走了再重新找
  let desk = 0;
  function desktopWindow() {
    if (desk && api.IsWindow(desk) && api.FindWindowExW(desk, 0, 'SHELLDLL_DefView', null)) return desk;
    desk = 0;
    const pm = api.FindWindowW('Progman', null);
    if (pm && api.FindWindowExW(pm, 0, 'SHELLDLL_DefView', null)) return (desk = pm);
    let w = 0;
    while ((w = api.FindWindowExW(0, w, 'WorkerW', null))) if (api.FindWindowExW(w, 0, 'SHELLDLL_DefView', null)) return (desk = w);
    return 0;
  }
  // 钉到桌面正上方：放在"紧挨着桌面上面的那个窗口"的下面。桌面上面是置顶窗口（比如任务栏）或者没有窗口时，放到普通窗口的最上面
  function toBottom() {
    if (!win || win.isDestroyed()) return;
    try {
      const me = hwnd(), d = desktopWindow();
      if (!d) { api.SetWindowPos(me, HWND_BOTTOM, 0, 0, 0, 0, SWP_FLAGS); return; }   // 找不到桌面：退回老办法
      const above = api.GetWindow(d, GW_HWNDPREV);
      if (above === me) return;
      const after = above && !(Number(api.GetWindowLongPtrW(above, GWL_EXSTYLE)) & WS_EX_TOPMOST) ? above : HWND_TOP;
      api.SetWindowPos(me, after, 0, 0, 0, 0, SWP_FLAGS);
    } catch (err) { /* 窗口刚好在销毁 */ }
  }
  // 快速检查：狗还在不在桌面正上方（两个系统调用）。Win+D 把桌面提上去、退出显示桌面时桌面落回去，都靠它很快跟上。
  // 别的桌面小工具（挂件、壁纸工具）也想待在这个位置时，两边会你挤我、我挤你，一秒好几次，白白耗着两个程序。
  // 3 秒里被挤走 6 次就认定在抢：之后一分钟只每 3 秒回去一次，不跟它较劲（狗还在所有程序窗口下面，只是不一定紧贴图标）
  let repins = [], yieldUntil = 0, lastTry = 0;
  function keepOnDesktop() {
    if (!win || win.isDestroyed()) return false;
    const now = Date.now();
    if (now < yieldUntil && now - lastTry < 3000) return false;
    lastTry = now;
    try {
      const d = desktopWindow();
      if (!d || api.GetWindow(d, GW_HWNDPREV) === hwnd()) return false;
      toBottom();
      repins = repins.filter(t => now - t < 3000); repins.push(now);
      if (repins.length >= 6) { yieldUntil = now + 60000; repins = []; }
      return true;
    } catch (err) { return false; }
  }
  const yielding = () => Date.now() < yieldUntil;

  // 压在宠物上面、真正挡得住视线的窗口：可见、没最小化、不是透明/工具/悬浮小窗、没被系统隐藏，
  // 并且是带标题栏的普通窗口或者铺满整块屏幕（全屏游戏、放映）
  let cache = null, cacheAt = 0;
  function coverRects() {
    const now = Date.now();
    if (cache && now - cacheAt < 300) return cache;
    const out = [];
    const monitors = screen.getAllDisplays().map(d => screen.dipToScreenRect(null, d.bounds));
    try {
      // 宠物在最底层，它上面压着系统里所有窗口（大部分是看不见的后台窗口，常常上千个），
      // 而你正在用的程序窗口在最上面：一定要走到顶，不能半路停（以前只走 600 个，窗口一多就漏掉最上面的）
      let h = api.GetWindow(hwnd(), GW_HWNDPREV), n = 0;
      while (h && n++ < 20000) {
        if (api.IsWindowVisible(h) && !api.IsIconic(h)) {
          const ex = Number(api.GetWindowLongPtrW(h, GWL_EXSTYLE)), st = Number(api.GetWindowLongPtrW(h, GWL_STYLE));
          if (!(ex & (WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE))) {
            const cloaked = [0];
            api.DwmInt(h, DWMWA_CLOAKED, cloaked, 4);
            if (!cloaked[0]) {
              const r = {};
              if (api.DwmRect(h, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) !== 0) api.GetWindowRect(h, r);
              const full = monitors.some(m => r.left <= m.x && r.top <= m.y && r.right >= m.x + m.width && r.bottom >= m.y + m.height);
              if (r.right - r.left > 40 && r.bottom - r.top > 40 && ((st & WS_CAPTION) === WS_CAPTION || full)) out.push(r);
            }
          }
        }
        h = api.GetWindow(h, GW_HWNDPREV);
      }
    } catch (err) { return []; }
    cache = out; cacheAt = now;
    return out;
  }
  const toPhysical = (x, y) => screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) });

  // box：狗在屏幕上的范围（逻辑像素 [x0, y0, x1, y1]）。整只狗都被某一个窗口盖住才算
  function boxCovered(box) {
    if (!box) return false;
    const a = toPhysical(box[0], box[1]), b = toPhysical(box[2], box[3]);
    return coverRects().some(r => r.left <= a.x && r.top <= a.y && r.right >= b.x && r.bottom >= b.y);
  }
  // 鼠标这一点上面有没有别的窗口
  function pointCovered(x, y) {
    const p = toPhysical(x, y);
    return coverRects().some(r => p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom);
  }

  // 鼠标这一点按下去，系统会把点击交给谁（WindowFromPoint 就是系统分发点击用的规则）。
  // 交给狗的窗口、狗底下的桌面，或者压在狗下面的窗口（狗那块是透明的、点穿过去了）：都不算挡住；
  // 交给压在狗上面的任何窗口都算挡住——包括 pointCovered 认不出来的：没有标题栏的程序、开始菜单、弹出菜单、
  // 托盘弹窗、自动隐藏后滑出来的任务栏。认不准的时候算挡住：宁可这一下狗没反应，也不能把你在别的程序里的点击抢过来
  const clsBuf = Buffer.alloc(256);
  const className = h => { const n = api.GetClassNameW(h, clsBuf, 128); return clsBuf.toString('utf16le', 0, Math.max(0, n) * 2); };
  let belowCache = { root: 0, at: 0, below: false };
  function isBelowMe(root) {
    const now = Date.now();
    if (belowCache.root === root && now - belowCache.at < 300) return belowCache.below;
    let h = api.GetWindow(hwnd(), GW_HWNDNEXT), n = 0, below = false;
    while (h && n++ < 20000) { if (h === root) { below = true; break; } h = api.GetWindow(h, GW_HWNDNEXT); }
    belowCache = { root, at: now, below };
    return below;
  }
  function pointBlocked(x, y) {
    try {
      const p = toPhysical(x, y);
      const h = api.WindowFromPoint({ x: p.x, y: p.y });
      if (!h) return false;
      const root = api.GetAncestor(h, GA_ROOT) || h, me = hwnd();
      if (root === me || root === desktopWindow()) return false;
      const c = className(root);
      if (c === 'Progman' || c === 'WorkerW') return false;
      return !isBelowMe(root);
    } catch (err) { return true; }
  }

  // 鼠标主键现在是不是按着（左撇子把左右键对调了也算对）。拎狗时页面偶尔收不到"松开"，主进程用它兜底
  function primaryButtonDown() {
    try {
      const vk = api.GetSystemMetrics(23 /* SM_SWAPBUTTON */) ? 0x02 : 0x01;
      return (api.GetAsyncKeyState(vk) & 0x8000) !== 0;
    } catch (err) { return null; }
  }

  return { toBottom, keepOnDesktop, yielding, boxCovered, pointCovered, pointBlocked, primaryButtonDown, coverCount: () => coverRects().length };
}

module.exports = { create };
