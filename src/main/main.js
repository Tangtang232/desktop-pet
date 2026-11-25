// 主进程：一个铺满工作区（不含任务栏）的透明窗口，默认鼠标点穿；
// 鼠标移到宠物身上时由渲染进程通知，切成可点击。
const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, globalShortcut, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const logic = require('../renderer/logic.js');

const isDev = process.argv.includes('--dev');
const isSmoke = process.argv.includes('--smoke');
// 性能测量：--bench=walk / --bench=sit …… 固定一个动作、不读写真实存档，方便前后对比 CPU 占用
const benchArg = process.argv.find(a => a.startsWith('--bench='));
const bench = benchArg ? benchArg.slice(8) : null;
const SMOKE_DIR = path.join(__dirname, '..', '..', 'tools', 'out', 'smoke');
let win = null;
let noteWin = null;
let tray = null;
let hidden = false;
let latestState = null;

// 冒烟测试用临时目录，不碰真实存档，也不和正在运行的那只狗抢单实例锁
if (isSmoke || bench) app.setPath('userData', path.join(os.tmpdir(), `desktop-pet-${isSmoke ? 'smoke' : 'bench'}-${Date.now()}`));
else if (!app.requestSingleInstanceLock()) app.quit();

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
const workArea = () => waCache || (waCache = isSmoke ? { x: 0, y: 0, width: 1400, height: 520 } : screen.getPrimaryDisplay().workArea);
function windowBounds() {
  const wa = workArea();
  if (isSmoke || expanded) return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  // 底部一条的高度：狗站着高度的 2.8 倍，至少 340；再微调到"上沿在物理像素上是整数"，免得画面被插值糊掉
  const sf = isSmoke ? 1 : screen.getPrimaryDisplay().scaleFactor || 1;
  let h = Math.min(wa.height, Math.round(Math.max(logic.petHeightFor(wa.height) * 2.8, 340)));
  while (h < wa.height && Math.abs(((wa.height - h) * sf) % 1) > 1e-6) h++;
  return { x: wa.x, y: wa.y + wa.height - h, width: wa.width, height: h };
}
const frameInfo = () => { const wa = workArea(); return { wx: wa.x, wy: wa.y, ww: wa.width, wh: wa.height }; };
function fitToWorkArea() {
  if (!win || isSmoke) return;
  waCache = null;
  win.setBounds(windowBounds());
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
    alwaysOnTop: !isSmoke,
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
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    win.setIgnoreMouseEvents(true);
    win.once('ready-to-show', () => win.showInactive());
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
function startCursorWatch() {
  let lx = null, ly = null, lastSent = 0;
  setInterval(() => {
    if (!win || hidden) return;
    const p = screen.getCursorScreenPoint();
    if (p.x === lx && p.y === ly) return;
    const wa = workArea(), x = p.x - wa.x, y = p.y - wa.y, now = Date.now();
    const near = !petBox || (x > petBox[0] - 300 && x < petBox[2] + 300 && y > petBox[1] - 300 && y < petBox[3] + 300);
    if (!near && now - lastSent < 250) return;   // 先不记下这次位置，下一轮还会再发
    lx = p.x; ly = p.y; lastSent = now;
    win.webContents.send('pet:command', { type: 'cursor', value: [x, y] });
  }, 40);
}

// ---------- 写纸条的小窗口 ----------
function openNoteWindow() {
  if (noteWin) { noteWin.show(); noteWin.focus(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  noteWin = new BrowserWindow({
    width: 380, height: 280,
    x: wa.x + wa.width - 420, y: wa.y + wa.height - 330,
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'note-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  noteWin.loadFile(path.join(__dirname, '..', 'renderer', 'note.html'));
  noteWin.once('ready-to-show', () => { noteWin.show(); noteWin.focus(); });
  noteWin.on('closed', () => { noteWin = null; });
}
ipcMain.on('note:send', (_e, text) => {
  const clean = logic.cleanNote(text);
  if (clean) send('note', clean);
  if (noteWin) noteWin.close();
});
ipcMain.on('note:cancel', () => { if (noteWin) noteWin.close(); });

// ---------- 菜单（托盘和右键共用） ----------
const send = (type, value) => win && win.webContents.send('pet:command', { type, value });
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '喂一碗', click: () => send('feed') },
    { label: '写张纸条让它带走', click: openNoteWindow },
    { type: 'separator' },
    { label: hidden ? '叫它回来' : '暂时藏起来', accelerator: 'CommandOrControl+Alt+B', click: toggleHidden },
    {
      label: '开机自动启动', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked })
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
}
function refreshTray() {
  if (tray) tray.setContextMenu(buildMenu());
}
function toggleHidden() {
  if (!win) return;
  hidden = !hidden;
  if (hidden) win.hide(); else { win.setIgnoreMouseEvents(true); win.showInactive(); lastBeat = Date.now(); }
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
  if (win && !isSmoke) win.setIgnoreMouseEvents(!on);
});
// 被拎起来时窗口铺满工作区，落地后缩回底部一条
ipcMain.on('pet:expand', (_e, on) => {
  if (!win || isSmoke || !!on === expanded) return;
  expanded = !!on;
  win.setBounds(windowBounds());
});
ipcMain.on('pet:menu', () => {
  if (win) buildMenu().popup({ window: win });
});
ipcMain.on('pet:heartbeat', () => { lastBeat = Date.now(); });
ipcMain.on('pet:tooltip', (_e, text) => { if (tray && typeof text === 'string') tray.setToolTip(text.slice(0, 60)); });
ipcMain.handle('pet:load', () => {
  // 页面（重新）加载时窗口回到底部一条
  if (win && !isSmoke && expanded) { expanded = false; win.setBounds(windowBounds()); }
  return {
  state: logic.sanitizeState(readJson('pet-state.json', null)),
  settings, now: Date.now(), dev: isDev, smoke: isSmoke, bench, frame: frameInfo(),
    benchFps: bench ? Number(process.env.PET_BENCH_FPS) || 0 : 0, benchNoRender: !!(bench && process.env.PET_BENCH_NORENDER)
  };
});
ipcMain.on('pet:save', (_e, state) => {
  const clean = logic.sanitizeState(state);
  if (!clean || isSmoke || bench) return;
  latestState = clean;
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
  createTray();
  startWatchdog();
  startIdleWatch();
  startCursorWatch();
  // 保险：万一点穿出了问题挡住桌面，Ctrl+Alt+B 立刻把它藏起来 / 叫回来
  globalShortcut.register('CommandOrControl+Alt+B', toggleHidden);
  screen.on('display-metrics-changed', fitToWorkArea);
  screen.on('display-added', fitToWorkArea);
  screen.on('display-removed', fitToWorkArea);
});
app.on('second-instance', () => { if (hidden) toggleHidden(); });
app.on('before-quit', () => { if (latestState && !isSmoke) writeJson('pet-state.json', latestState); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
