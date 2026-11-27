// 主进程：一个铺满工作区（不含任务栏）的透明窗口，默认鼠标点穿；
// 鼠标移到宠物身上时由渲染进程通知，切成可点击。
const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, powerMonitor, safeStorage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const logic = require('../renderer/logic.js');
const deskLayer = require('./desktop-layer.js');
const Together = require('./together.js');

const isDev = process.argv.includes('--dev');
const isSmoke = process.argv.includes('--smoke');
// 性能测量：--bench=walk / --bench=sit …… 固定一个动作、不读写真实存档，方便前后对比 CPU 占用
const benchArg = process.argv.find(a => a.startsWith('--bench='));
const bench = benchArg ? benchArg.slice(8) : null;
// 用 --user-data-dir 指定了别的存档目录的，都是测试用的副本：不建托盘图标，
// 免得和桌面上正在养的那只混在一起，被测试脚本关掉时也不会在托盘里留下点不动的图标
const isTestCopy = app.commandLine.hasSwitch('user-data-dir');
// 测试副本在桌面上完全透明、点不到、不抢焦点：测试脚本照样能截它的画面，但你的桌面上不会多出一只狗、不会突然弹出窗口。
// 要用真鼠标拖它的老测试脚本，设 PET_TEST_VISIBLE=1 让它露出来
const testHidden = isTestCopy && !process.env.PET_TEST_VISIBLE;
// 冒烟测试的截图：从源码跑时放 tools/out/smoke；装好的版本程序目录是只读的打包文件，放到系统临时目录
const SMOKE_DIR = app.isPackaged ? path.join(os.tmpdir(), 'desktop-pet-smoke') : path.join(__dirname, '..', '..', 'tools', 'out', 'smoke');
const APP_ID = 'com.desktoppet.beagle';
// 开机自启：装好的版本直接启动它自己；从源码跑时要带上项目目录，不然开机只会打开一个空的 Electron
const loginOpts = () => app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
let win = null;
let layer = null;   // 桌面层（Windows）：把窗口压在所有程序窗口下面，判断有没有被盖住
const sinkWindow = () => { if (layer) layer.toBottom(); };
let noteWin = null;
let togetherWin = null;
// 合养（联网）：没配 Supabase 时是关着的，狗照旧单机过日子
let together = null;
let tray = null;
let hidden = false;
let latestState = null;

// 冒烟测试用临时目录，不碰真实存档，也不和正在运行的那只狗抢单实例锁
if (isSmoke || bench) app.setPath('userData', path.join(os.tmpdir(), `desktop-pet-${isSmoke ? 'smoke' : 'bench'}-${Date.now()}`));
else {
  // 存档目录固定在 %APPDATA%\desktop-pet：装好的版本（程序名是"桌面比格"）和从源码跑的版本用同一份，
  // 换成安装版后狗还是那只、合养也还在；两边共用一把单实例锁，不会同时开出两只。测试副本照旧用它自己指定的目录
  if (!isTestCopy) app.setPath('userData', path.join(app.getPath('appData'), 'desktop-pet'));
  if (!app.requestSingleInstanceLock()) app.quit();
}
// 装好的版本：系统通知、任务栏分组认这个身份（和安装包里的 appId 一致）
if (app.isPackaged) app.setAppUserModelId(APP_ID);

// ---------- 存档：先写临时文件再改名，写到一半断电也不会把存档写坏 ----------
const dataFile = name => path.join(app.getPath('userData'), name);
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); } catch { return fallback; }
}
function writeJson(name, value) {
  const file = dataFile(name), tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error(`[main] 写入 ${name} 失败:`, err);
  }
}
const settings = Object.assign({}, readJson('settings.json', {}));
delete settings.size;   // 大小改成按屏幕自适应，旧设置里的大小不再使用
delete settings.auto;   // 不再提供手动摆姿势，它一直自己随机活动

// ---------- 宠物窗口 ----------
// 省 CPU：窗口平时只盖工作区底部一条（狗活动的那一带），被拎起来、掉落时才临时铺满整个工作区。
// 页面里的画布始终和工作区一样高、贴着窗口底边，所以窗口变高变矮时画面不会动。
let expanded = false;
let waCache = null;
// 多块屏幕：狗的窗口一次只在一块屏幕上（记住是哪块，下次打开还在那儿）。那块屏幕拔掉了就回到主屏幕
let curDisplayId = typeof settings.display === 'number' ? settings.display : null;
function curDisplay() {
  const d = curDisplayId != null ? screen.getAllDisplays().find(x => x.id === curDisplayId) : null;
  return d || screen.getPrimaryDisplay();
}
const workArea = () => waCache || (waCache = isSmoke ? { x: 0, y: 0, width: 1400, height: 520 } : curDisplay().workArea);
// 左右挨着的屏幕：工作区的边贴在一起（差几个像素也算），上下有一大段重叠（狗走过去不会凭空掉下去）
function neighbors() {
  if (isSmoke) return { left: null, right: null };
  const cur = curDisplay(), a = cur.workArea, all = screen.getAllDisplays().filter(d => d.id !== cur.id);
  const near = (x, y) => Math.abs(x - y) <= 8;
  const overlap = d => Math.min(a.y + a.height, d.workArea.y + d.workArea.height) - Math.max(a.y, d.workArea.y) > 200;
  const left = all.find(d => near(d.workArea.x + d.workArea.width, a.x) && overlap(d));
  const right = all.find(d => near(d.workArea.x, a.x + a.width) && overlap(d));
  return { left: left ? left.id : null, right: right ? right.id : null };
}
// 把狗的窗口挪到另一块屏幕（走过去、被拖过去）。拎着的时候照旧铺满那块屏幕的工作区
function moveToDisplay(id) {
  const d = screen.getAllDisplays().find(x => x.id === id);
  if (!d || !win || isSmoke) return false;
  curDisplayId = d.id; settings.display = d.id; writeJson('settings.json', settings);
  waCache = null;
  win.setBounds(windowBounds());
  if (!raised && !expanded) sinkWindow();
  win.webContents.send('pet:command', { type: 'frame', value: frameInfo() });
  return true;
}
function windowBounds() {
  const wa = workArea();
  if (isSmoke || expanded) return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  // 底部一条的高度：狗站着高度的 2.8 倍，至少 340；再微调到"上沿在物理像素上是整数"，免得画面被插值糊掉
  const sf = isSmoke ? 1 : curDisplay().scaleFactor || 1;
  let h = Math.min(wa.height, Math.round(Math.max(logic.petHeightFor(wa.height) * 2.8, 340)));
  while (h < wa.height && Math.abs(((wa.height - h) * sf) % 1) > 1e-6) h++;
  return { x: wa.x, y: wa.y + wa.height - h, width: wa.width, height: h };
}
const frameInfo = () => { const wa = workArea(), n = neighbors(); return { wx: wa.x, wy: wa.y, ww: wa.width, wh: wa.height, edges: { left: n.left != null, right: n.right != null } }; };
function fitToWorkArea() {
  if (!win || isSmoke) return;
  waCache = null;
  if (curDisplayId != null && !screen.getAllDisplays().some(d => d.id === curDisplayId)) curDisplayId = null;   // 那块屏幕拔掉了：回主屏幕
  win.setBounds(windowBounds());
  sinkWindow();
  win.webContents.send('pet:command', { type: 'frame', value: frameInfo() });
}

function createWindow() {
  const b = windowBounds();
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: false,   // 宠物待在桌面层：程序窗口会盖住它
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  if (!isSmoke) {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    win.setIgnoreMouseEvents(true);
    // 桌面层：显示出来后压到所有程序窗口下面（Windows）；其他系统暂时只是不置顶的普通窗口
    layer = deskLayer.create(win);
    if (testHidden) win.setOpacity(0);
    win.once('ready-to-show', () => { win.showInactive(); sinkWindow(); });
    // Win+D（显示桌面）之类把它最小化时，马上放回桌面上
    win.on('minimize', () => { setTimeout(() => { if (win && !hidden) { win.restore(); win.showInactive(); sinkWindow(); } }, 50); });
  }
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (isDev || isSmoke || bench) {
    win.webContents.on('console-message', ev => {
      console.log(`[renderer] ${ev.message} (${path.basename(String(ev.sourceId || ''))}:${ev.lineNumber})`);
    });
  }
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] 渲染进程退出:', details.reason);
    recover('渲染进程退出');
  });
  win.on('unresponsive', () => recover('页面无响应'));
  win.on('closed', () => { win = null; });
}

// ---------- 看门狗：页面每秒报一次平安；几秒没消息就先恢复点穿，再重载页面 ----------
let lastBeat = Date.now();
let lastRecover = 0;
function recover(reason) {
  if (!win || isSmoke) return;
  win.setIgnoreMouseEvents(true);
  if (Date.now() - lastRecover < 30000) return;
  lastRecover = Date.now();
  console.error(`[main] ${reason}，恢复点穿并重载页面`);
  lastBeat = Date.now();
  win.webContents.reload();
}
function startWatchdog() {
  setInterval(() => {
    if (!win || hidden || isSmoke) return;
    const silent = Date.now() - lastBeat;
    if (silent > 4000) win.setIgnoreMouseEvents(true);
    if (silent > 9000) recover('页面 9 秒没有心跳');
  }, 1000);
}

// ---------- 人在不在电脑前：每 5 秒告诉页面键鼠空闲了多少秒 ----------
function startIdleWatch() {
  const tell = sec => win && win.webContents.send('pet:command', { type: 'idle', value: sec });
  setInterval(() => tell(powerMonitor.getSystemIdleTime()), 5000);
  powerMonitor.on('lock-screen', () => tell(24 * 3600));
  powerMonitor.on('unlock-screen', () => tell(0));
  powerMonitor.on('resume', () => tell(powerMonitor.getSystemIdleTime()));
}

// ---------- 鼠标位置：主进程每 40 毫秒看一眼，变了才告诉页面 ----------
// 以前靠"点穿时也把鼠标移动转发给页面"，Windows 上这个转发本身就吃 CPU；改成轮询以后，页面只在鼠标真的动了才收到消息。
// 鼠标离狗远时（你在别处干活）最多每 250 毫秒发一次，靠近狗时每 40 毫秒发一次
let petBox = null;
ipcMain.on('pet:box', (_e, b) => { petBox = Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) ? b : null; });
// 鼠标键也在这里盯：狗的窗口不抢焦点，别的程序在前台时，点狗的第一下"按下"可能被 Chromium 当成激活点击吃掉，
// 页面只收到"松开"，狗就拖不动。所以按下、松开、按着时的位置，主进程都另外告诉页面一份，页面两路谁先到算谁。
let pageInteractive = false;
function startCursorWatch() {
  let lx = null, ly = null, lc = null, lastSent = 0, btnDown = false, pressSent = false;
  // 这一点按下去会不会落到别的窗口上（开始菜单、弹出菜单、无边框程序、自动隐藏的任务栏、我们自己的小窗口……）
  const blockedAt = p => !bench && (overPopup(p) || (layer ? layer.pointBlocked(p.x, p.y) : false));
  setInterval(() => {
    if (!win || hidden) return;
    const p = screen.getCursorScreenPoint();
    const wa = workArea(), x = p.x - wa.x, y = p.y - wa.y, now = Date.now();
    const down = layer && layer.primaryButtonDown ? layer.primaryButtonDown() : null;
    if (down !== null && down !== btnDown) {
      btnDown = down;
      // 按下时鼠标在狗身上（页面已经切成可点），并且这一下真落在狗的窗口上：告诉页面"按下了"；之后的松开也一定告诉它。
      // 落在盖住狗的别的窗口上（开始菜单、别的程序……）绝不能算：不然你在别的程序里点一下，狗会被一起拎起来，还会顶到最前面
      if (down && pageInteractive && !isSmoke && !blockedAt(p)) { pressSent = true; win.webContents.send('pet:command', { type: 'mouseDown', value: [x, y] }); }
      else if (!down && pressSent) { pressSent = false; win.webContents.send('pet:command', { type: 'mouseUp' }); }
    }
    const near = !petBox || (x > petBox[0] - 300 && x < petBox[2] + 300 && y > petBox[1] - 300 && y < petBox[3] + 300);
    // 鼠标在别的窗口上（那个窗口盖在狗上面）：告诉页面别把它当成在摸狗。
    // 鼠标没动、但有窗口弹到它下面（比如按 Win 键打开开始菜单）时也要重新告诉页面
    const covered = near ? blockedAt(p) : false;
    if (p.x === lx && p.y === ly && covered === lc) return;
    if (!near && !pressSent && now - lastSent < 250) return;   // 先不记下这次位置，下一轮还会再发；按着狗拖的时候每次都发
    lx = p.x; ly = p.y; lc = covered; lastSent = now;
    win.webContents.send('pet:command', { type: 'cursor', value: [x, y, covered ? 1 : 0] });
  }, 40);
}

// ---------- 桌面层：每 2 秒确认一次窗口还在最下面；每秒看一次狗是不是整只被别的窗口盖住 ----------
// 盖住时页面停止绘制（只算消化），省掉几乎全部占用；露出来马上恢复
let occluded = false;
function startLayerWatch() {
  if (!layer) return;
  let tick = 0;
  // 每 0.2 秒看一眼狗还在不在桌面正上方：按 Win+D 时桌面被提到前面，狗要跟上去；退出显示桌面时再跟着落回来
  if (layer.keepOnDesktop) setInterval(() => { if (win && !hidden && !raised && !expanded) layer.keepOnDesktop(); }, 200);
  setInterval(() => {
    if (!win || hidden) return;
    if (raised || expanded) return;   // 展开纸条、拎着狗的时候临时在最前面，别把它压下去
    if (++tick % 2 === 0 && !layer.keepOnDesktop) sinkWindow();   // 有 keepOnDesktop 时它每 0.2 秒管着（还会在和别的程序抢位置时退让），这里不再插手
    if (bench) return;
    const wa = workArea();
    const covered = !!petBox && layer.boxCovered([petBox[0] + wa.x, petBox[1] + wa.y, petBox[2] + wa.x, petBox[3] + wa.y]);
    if (isDev && tick % 5 === 0) console.log(`[desktop-layer] 狗的范围 ${petBox ? petBox.join(',') : '无'}  上面挡得住视线的窗口 ${layer.coverCount()} 个  整只被盖住 ${covered}`);
    if (covered !== occluded) {
      occluded = covered;
      if (isDev) console.log(`[desktop-layer] ${covered ? '被盖住了，停止绘制' : '露出来了，恢复绘制'}`);
      win.webContents.send('pet:command', { type: 'occluded', value: covered });
    }
  }, 1000);
}

// ---------- 写纸条、一起养的小窗口 ----------
// 放在屏幕右下、狗走路那一条的上面：窗口（连同四周透明的那圈边）压在狗身上的话，狗就拖不动、点不着了
function popupBounds(w, h) {
  const wa = isSmoke ? screen.getPrimaryDisplay().workArea : curDisplay().workArea;   // 开在狗所在的那块屏幕上
  const clear = Math.round(logic.petHeightFor(wa.height) * 1.7);   // 狗站着的高度再留些蹦跳的余地
  return { width: w, height: h, x: wa.x + wa.width - w - 40, y: Math.max(wa.y, wa.y + wa.height - clear - h) };
}
// 鼠标在我们自己的小窗口上：当成狗被挡住了（小窗口被拖下来盖住狗时，别让狗以为自己能点）
function overPopup(p) {
  for (const w of [noteWin, togetherWin, watchWin, diaryWin]) {
    if (!w || w.isDestroyed() || !w.isVisible() || testHidden) continue;
    const b = w.getBounds();
    if (p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height) return true;
  }
  return false;
}
// 写纸条、一起养的小窗口只在你正用着它的时候浮在最上面；你点回别的程序，它就待到那个程序后面，不压着别人干活。
// 想接着写：再点一次菜单里的"写张纸条"/"一起养"，它带着没写完的内容回到最前面
function politePopup(w) {
  w.on('blur', () => { if (!w.isDestroyed()) w.setAlwaysOnTop(false); });
  w.on('focus', () => { if (!w.isDestroyed()) w.setAlwaysOnTop(true); });
}
function bringBack(w) { if (testHidden) return; w.setAlwaysOnTop(true); w.show(); w.focus(); }
function openNoteWindow() {
  if (noteWin) { bringBack(noteWin); return; }
  noteWin = new BrowserWindow({
    ...popupBounds(400, 330),
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'note-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  noteWin.loadFile(path.join(__dirname, '..', 'renderer', 'note.html'));
  if (testHidden) { noteWin.setOpacity(0); noteWin.setIgnoreMouseEvents(true); noteWin.setFocusable(false); }
  noteWin.once('ready-to-show', () => { if (testHidden) noteWin.showInactive(); else { noteWin.show(); noteWin.focus(); } });
  politePopup(noteWin);
  noteWin.on('closed', () => { noteWin = null; });
}
// 合养时纸条交给服务器，由它叼去给朋友；没合养时照旧本机演示（叼出去转一圈再叼回来）
ipcMain.handle('note:info', () => together && together.ready ? together.noteInfo() : { mode: together ? together.view().mode : 'off' });
ipcMain.handle('note:send', async (_e, text) => {
  const clean = logic.cleanNote(text);
  if (!clean) return { ok: false, error: '纸条是空的' };
  if (together && together.ready) {
    const r = await together.sendNote(clean);
    if (r.ok) setTimeout(() => { if (noteWin) noteWin.close(); }, 1600);
    return r;
  }
  send('note', clean);
  setTimeout(() => { if (noteWin) noteWin.close(); }, 50);
  return { ok: true, how: 'demo' };
});
ipcMain.on('note:cancel', () => { if (noteWin) noteWin.close(); });

// ---------- 合养：联网、合养窗口 ----------
function startTogether() {
  together = Together.create({
    userDataDir: app.getPath('userData'), safeStorage,
    toPage: (type, value) => send(type, value),
    getIdleSec: () => powerMonitor.getSystemIdleTime(),
    notify: text => { if (tray && process.platform === 'win32') tray.displayBalloon({ title: '桌面比格', content: String(text).slice(0, 120), noSound: true }); else console.log('[together] 提示:', text); },
    diary: text => addDiary(text),
    onView: v => {
      if (tray) tray.setToolTip(v.mode === 'ready' ? (v.here ? '桌面比格' : `桌面比格：在 ${v.host ? v.host.nickname : '朋友'} 那儿`) : '桌面比格');
      refreshTray();
    }
  });
  together.start();
}
function togetherMenu() {
  if (!together || !together.enabled) return [];
  const v = together.view();
  const items = [{ label: v.pending && v.pending.length ? `一起养…（${v.pending.length} 人等你同意）` : '一起养…', click: openTogetherWindow }];
  if (v.mode === 'ready' && v.onMyOther) {
    items.push({ label: '叫它过来（它在你另一台电脑上）', click: async () => {
      const r = await together.callPet();
      if (tray) tray.displayBalloon({ title: '桌面比格', content: r.ok ? '叫了，那台闲下来它就过来' : r.error, noSound: true });
    } });
  } else if (v.mode === 'ready' && !v.here && v.host) {
    items.push({ label: '看看它', click: openWatchWindow });
    items.push({ label: `叫它回来（它在 ${v.host.nickname} 那儿）`, enabled: !!v.canCall, click: async () => {
      const r = await together.callPet();
      if (tray) tray.displayBalloon({ title: '桌面比格', content: r.ok ? '叫了，它马上就来' : r.error, noSound: true });
    } });
  }
  return items;
}
function openTogetherWindow() {
  if (togetherWin) { bringBack(togetherWin); return; }
  togetherWin = new BrowserWindow({
    ...popupBounds(400, 400),
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'together-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  togetherWin.loadFile(path.join(__dirname, '..', 'renderer', 'together.html'));
  if (testHidden) { togetherWin.setOpacity(0); togetherWin.setIgnoreMouseEvents(true); togetherWin.setFocusable(false); }
  togetherWin.once('ready-to-show', () => { if (testHidden) togetherWin.showInactive(); else { togetherWin.show(); togetherWin.focus(); } });
  // 窗口开着时才订阅状态（并且每 5 秒刷新一次），关了就停
  const stopView = together ? together.onWindowView(v => { if (togetherWin) togetherWin.webContents.send('together:view', v); }) : () => {};
  politePopup(togetherWin);
  togetherWin.on('closed', () => { stopView(); togetherWin = null; });
}
ipcMain.handle('together:view', () => together ? together.view(true) : { mode: 'off' });
ipcMain.handle('together:create', (_e, nick) => together ? together.createPet(nick) : { ok: false, error: '合养没打开' });
ipcMain.handle('together:join', (_e, code, nick) => together ? together.joinPet(code, nick) : { ok: false, error: '合养没打开' });
ipcMain.handle('together:approve', (_e, id, ok) => together ? together.approve(id, ok) : { ok: false });
ipcMain.handle('together:rename', (_e, nick) => together ? together.rename(nick) : { ok: false });
ipcMain.handle('together:call', () => together ? together.callPet() : { ok: false });
ipcMain.on('together:copy', (_e, text) => clipboard.writeText(String(text).slice(0, 64)));
ipcMain.on('together:close', () => { if (togetherWin) togetherWin.close(); });
// 页面那边：狗走出屏幕了、走进来了、看完纸条了、你和它的互动
ipcMain.on('together:departed', (_e, state) => { if (together) together.departed(state); });
ipcMain.on('together:arrived', () => { if (together) together.arrived(); });
ipcMain.on('together:noteRead', (_e, id) => { if (together) together.noteRead(id); });
ipcMain.on('together:event', (_e, kind) => { if (together) together.heartEvent(kind); });

// ---------- 日记：它这辈子的大事（本机记，最多 500 条；托盘"它的日记"里看） ----------
let diaryWin = null;
function addDiary(text, at) {
  if (isSmoke || bench || typeof text !== 'string' || !text.trim()) return;
  const list = readJson('diary.json', []), t = at || Date.now(), clean = Array.from(text.trim()).slice(0, 80).join('');
  if (!Array.isArray(list)) return;
  if (list.some(e => e && e.text === clean && t - e.at < 10 * 60 * 1000)) return;   // 十分钟内同一句不重复记
  list.push({ at: t, text: clean });
  const keep = list.slice(-500);
  writeJson('diary.json', keep);
  if (diaryWin && !diaryWin.isDestroyed()) diaryWin.webContents.send('diary:list', keep);
}
ipcMain.on('pet:diary', (_e, text) => addDiary(String(text)));
ipcMain.handle('diary:list', () => { const l = readJson('diary.json', []); return Array.isArray(l) ? l.slice(-500) : []; });
ipcMain.on('diary:close', () => { if (diaryWin) diaryWin.close(); });
function openDiaryWindow() {
  if (diaryWin) { bringBack(diaryWin); return; }
  diaryWin = new BrowserWindow({
    ...popupBounds(380, 440),
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'diary-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  diaryWin.loadFile(path.join(__dirname, '..', 'renderer', 'diary.html'));
  if (testHidden) { diaryWin.setOpacity(0); diaryWin.setIgnoreMouseEvents(true); diaryWin.setFocusable(false); }
  diaryWin.once('ready-to-show', () => { if (testHidden) diaryWin.showInactive(); else { diaryWin.show(); diaryWin.focus(); } });
  politePopup(diaryWin);
  diaryWin.on('closed', () => { diaryWin = null; });
}

// ---------- "看看它"：狗在别人那儿时远程看它、喂一碗、叫它回来 ----------
// 开着时每分钟告诉服务器"有人在看"（狗所在那台就每 4 秒传一张狗的小图），每 3 秒取一次最新的小图给窗口；关掉就停
let watchWin = null;
function openWatchWindow() {
  if (!together || !together.ready) return;
  if (watchWin) { bringBack(watchWin); return; }
  watchWin = new BrowserWindow({
    ...popupBounds(320, 330),
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'watch-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  watchWin.loadFile(path.join(__dirname, '..', 'renderer', 'watch.html'));
  if (testHidden) { watchWin.setOpacity(0); watchWin.setIgnoreMouseEvents(true); watchWin.setFocusable(false); }
  watchWin.once('ready-to-show', () => { if (testHidden) watchWin.showInactive(); else { watchWin.show(); watchWin.focus(); } });
  politePopup(watchWin);
  // 小图多久没变了：狗那边的电脑睡着、关机时，不再显示一张旧图
  let lastAt = null, sameSince = Date.now(), stopped = false;
  const push = async () => {
    if (stopped || !watchWin || watchWin.isDestroyed()) return;
    const v = together.view();
    let snap = null;
    if (!v.here && !v.onMyOther && !v.traveling) { try { snap = await together.latestSnapshot(); } catch {} }
    if (snap && snap.at !== lastAt) { lastAt = snap.at; sameSince = Date.now(); }
    const fresh = snap && Date.now() - sameSince < 20000;
    if (!watchWin || watchWin.isDestroyed()) return;
    watchWin.webContents.send('watch:frame', {
      hostName: v.host ? v.host.nickname : '', here: v.here, onMyOther: v.onMyOther, traveling: v.traveling,
      doing: (fresh && snap.doing) || v.doing || '', img: fresh ? snap.img : null, waiting: !snap,
      canFeed: v.canFeed, canCall: !!v.canCall, callWhy: v.callWhy || null, kept: v.kept
    });
  };
  together.watch(true);
  const renew = setInterval(() => together.watch(true), 60000);
  const poll = setInterval(push, 3000);
  watchWin.webContents.on('did-finish-load', () => { push(); setTimeout(push, 1500); });
  watchWin.on('closed', () => { stopped = true; clearInterval(renew); clearInterval(poll); together.watch(false); watchWin = null; });
}
ipcMain.handle('together:feed', () => together ? together.remoteFeed() : { ok: false });
ipcMain.on('together:openWatch', () => openWatchWindow());
ipcMain.on('watch:close', () => { if (watchWin) watchWin.close(); });
ipcMain.on('together:keep', (_e, keep) => { if (together) together.answerCall(!!keep); });
ipcMain.on('together:snapshot', (_e, img, act) => { if (together) together.postSnapshot(img, act); });
ipcMain.handle('together:peek', (_e, code) => together ? together.peek(code) : { ok: false, error: '合养没打开' });
ipcMain.handle('together:claim', (_e, code, member) => together ? together.claim(code, member) : { ok: false, error: '合养没打开' });
ipcMain.handle('together:approveDevice', (_e, user, member, ok) => together ? together.approveDevice(user, member, ok) : { ok: false });
ipcMain.handle('together:rotate', () => together ? together.rotateCode() : { ok: false });
ipcMain.handle('together:leave', () => together ? together.leave() : { ok: false });
ipcMain.handle('together:kick', (_e, target, ok) => together ? together.voteKick(target, ok) : { ok: false });

// ---------- 菜单（托盘和右键共用） ----------
const send = (type, value) => win && win.webContents.send('pet:command', { type, value });
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '喂一碗', click: () => send('feed') },
    { label: '写张纸条让它带走', click: openNoteWindow },
    { label: '它的日记', click: openDiaryWindow },
    ...(togetherMenu()),
    ...(unreadNotes > 0 ? [{ label: `看纸条（${unreadNotes} 张没看）`, click: () => send('readNote') }] : []),
    { type: 'separator' },
    { label: hidden ? '叫它回来' : '暂时藏起来', click: toggleHidden },
    {
      label: '开机自动启动', type: 'checkbox', checked: app.getLoginItemSettings(loginOpts()).openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked, ...loginOpts() })
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
}
// ---------- 纸条：右键地上的纸条、没看的纸条数、看纸条时把窗口临时提到最前面 ----------
let unreadNotes = 0;
let raised = false;
ipcMain.on('pet:unread', (_e, n) => { unreadNotes = Math.max(0, Math.min(99, n | 0)); refreshTray(); });
ipcMain.on('pet:noteMenu', () => {
  if (!win) return;
  Menu.buildFromTemplate([
    { label: '展开看看', click: () => send('noteAction', 'open') },
    { label: '让它叼走收起来', click: () => send('noteAction', 'stash') }
  ]).popup({ window: win });
});
// 宠物平时在桌面层，会被程序窗口盖住；展开纸条时临时提到最前面，收好后再放回桌面
ipcMain.on('pet:raise', (_e, on) => {
  if (!win || isSmoke || !!on === raised) return;
  raised = !!on;
  if (raised) { win.setAlwaysOnTop(true, 'floating'); win.moveTop(); }
  else if (!expanded) { win.setAlwaysOnTop(false); sinkWindow(); }
});
// 它叼回来纸条时，你可能正开着程序看不到桌面：托盘弹个提示
ipcMain.on('pet:notify', (_e, text) => {
  if (tray && process.platform === 'win32' && typeof text === 'string') tray.displayBalloon({ title: '桌面比格', content: text.slice(0, 120), noSound: true });
});

function refreshTray() {
  if (tray) tray.setContextMenu(buildMenu());
}
function toggleHidden() {
  if (!win) return;
  hidden = !hidden;
  if (hidden) win.hide(); else { win.setIgnoreMouseEvents(true); win.showInactive(); sinkWindow(); lastBeat = Date.now(); }
  refreshTray();
}
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icons', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('桌面比格');
  tray.on('click', () => { if (hidden) toggleHidden(); });
  refreshTray();
}

// ---------- 和宠物页面通信 ----------
ipcMain.on('pet:interactive', (_e, on) => {
  pageInteractive = !!on;
  if (win && !isSmoke && !testHidden) win.setIgnoreMouseEvents(!on);
});
// 被拎起来时窗口铺满工作区，落地后缩回底部一条
ipcMain.on('pet:expand', (_e, on) => {
  if (!win || isSmoke || !!on === expanded) return;
  expanded = !!on;
  win.setBounds(windowBounds());
  // 拎在手上、往下掉的时候临时提到所有窗口最上面：不然拖到别的程序窗口上方，狗会钻到那个窗口后面，像是突然消失了。
  // 落地后放回桌面层
  if (expanded) {
    win.setAlwaysOnTop(true, 'floating'); win.moveTop();
    if (occluded) { occluded = false; send('occluded', false); }
  } else if (!raised) { win.setAlwaysOnTop(false); sinkWindow(); }
  watchButtonRelease(expanded);
});
// 拎着狗的时候盯住鼠标键：页面偶尔收不到"松开"（比如右键菜单刚关掉就去拖），
// 那样狗会一直粘在鼠标上、铺满的窗口挡住整个桌面。这里看到键已经松开，就替页面放手
let releaseTimer = null;
function watchButtonRelease(on) {
  clearInterval(releaseTimer); releaseTimer = null;
  if (!on || !layer || !layer.primaryButtonDown) return;
  let upFor = 0;
  releaseTimer = setInterval(() => {
    if (!win || !expanded) { clearInterval(releaseTimer); releaseTimer = null; return; }
    const down = layer.primaryButtonDown();
    if (down === null) { clearInterval(releaseTimer); releaseTimer = null; return; }
    upFor = down ? 0 : upFor + 1;
    if (upFor === 2) send('mouseUp');   // 连续两次（约 80 毫秒）都是松开的才算
  }, 40);
}
ipcMain.on('pet:menu', () => {
  if (win) buildMenu().popup({ window: win });
});
ipcMain.on('pet:heartbeat', () => { lastBeat = Date.now(); });
// 狗要去旁边那块屏幕（dir：-1 左边，1 右边）：自己走出屏幕边、或者被你拖过了边
ipcMain.handle('pet:cross', (_e, dir) => {
  if (isSmoke) return { ok: true };
  const n = neighbors(), id = dir < 0 ? n.left : n.right;
  return { ok: id != null && moveToDisplay(id) };
});
// 诊断记录：页面发现输入异常（比如主进程看到按下了、页面自己没收到）时写一行，出问题时有据可查
ipcMain.on('pet:diag', (_e, entry) => {
  if (isSmoke || bench) return;
  try {
    const file = dataFile('diag.log');
    let size = 0; try { size = fs.statSync(file).size; } catch {}
    const line = JSON.stringify({ at: new Date().toISOString(), ...(entry && typeof entry === 'object' ? entry : { msg: String(entry) }) }).slice(0, 4000) + '\n';
    if (size > 256 * 1024) fs.writeFileSync(file, line); else fs.appendFileSync(file, line);
  } catch (err) { /* 写不了日志不影响狗 */ }
});
ipcMain.on('pet:tooltip', (_e, text) => { if (tray && typeof text === 'string') tray.setToolTip(text.slice(0, 60)); });
ipcMain.handle('pet:load', () => {
  // 页面（重新）加载时窗口回到底部一条
  if (win && !isSmoke && expanded) { expanded = false; watchButtonRelease(false); win.setBounds(windowBounds()); win.setAlwaysOnTop(false); sinkWindow(); }
  // 展开纸条时页面重载了（崩溃、卡死被看门狗重载）：纸条已经没了，窗口也要放回桌面层，不然会一直顶在最上面
  if (win && !isSmoke && raised) { raised = false; win.setAlwaysOnTop(false); sinkWindow(); }
  return {
  state: logic.sanitizeState(readJson('pet-state.json', null)),
  settings, now: Date.now(), dev: isDev, smoke: isSmoke, bench, frame: frameInfo(),
    e2e: !!process.env.PET_E2E,
    abroad: together ? together.startAbroad() : false,   // 合养：上次关程序时它在别人那儿   // 真桌面验收测试：页面暴露 window.__rig 供测试脚本读状态，行为和平时一样
    benchFps: bench ? Number(process.env.PET_BENCH_FPS) || 0 : 0, benchNoRender: !!(bench && process.env.PET_BENCH_NORENDER)
  };
});
ipcMain.on('pet:save', (_e, state) => {
  const clean = logic.sanitizeState(state);
  if (!clean || isSmoke || bench) return;
  latestState = clean;
  if (together) together.setLatestState({ ...clean, act: state && typeof state.act === 'string' ? state.act.slice(0, 16) : undefined });
  writeJson('pet-state.json', clean);
});

// ---------- 冒烟测试：页面把画面截成 PNG 发过来，跑完报结果退出 ----------
ipcMain.handle('smoke:shot', (_e, name, dataUrl) => {
  const safe = String(name).replace(/[^\w-]/g, '_');
  fs.mkdirSync(SMOKE_DIR, { recursive: true });
  fs.writeFileSync(path.join(SMOKE_DIR, `${safe}.png`), Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'));
  return true;
});
ipcMain.on('smoke:done', (_e, result) => {
  console.log(`[smoke] ${JSON.stringify(result)}`);
  setTimeout(() => app.exit(result && result.ok ? 0 : 1), 200);
});

// ---------- 生命周期 ----------
app.whenReady().then(() => {
  createWindow();
  if (isSmoke) {
    setTimeout(() => { console.error('[smoke] 超时'); app.exit(2); }, 120000);
    return;
  }
  // 测占用的那一份不建托盘图标、不抢快捷键：测完被关掉时不会在托盘里留下一个点不动的图标
  if (!bench && !isTestCopy) createTray();
  if (!bench) startTogether();
  // 真桌面验收测试（PET_E2E=1）：给测试脚本留个口子，能直接开窗口、看合养状态
  if (process.env.PET_E2E) global.__petMain = { openNoteWindow, openTogetherWindow, get together() { return together; }, get noteWin() { return noteWin; }, get togetherWin() { return togetherWin; }, get layer() { return layer; }, get win() { return win; }, openWatchWindow, get watchWin() { return watchWin; }, openDiaryWindow, get diaryWin() { return diaryWin; }, addDiary };
  startWatchdog();
  startIdleWatch();
  startCursorWatch();
  startLayerWatch();
  // 不注册系统级快捷键：全局快捷键会把这个组合键从所有程序手里抢走（比如 VS Code 的 Ctrl+Alt+B）。
  // 藏起来 / 叫回来走托盘菜单；托盘在任务栏上，狗的窗口永远盖不住它
  screen.on('display-metrics-changed', fitToWorkArea);
  screen.on('display-added', fitToWorkArea);
  screen.on('display-removed', fitToWorkArea);
});
app.on('second-instance', () => { if (hidden) toggleHidden(); });
app.on('before-quit', () => { if (latestState && !isSmoke) writeJson('pet-state.json', latestState); });
app.on('will-quit', () => { if (together) together.stop(); });
app.on('window-all-closed', () => app.quit());
