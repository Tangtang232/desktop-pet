// 给 README 做配图，出图在 docs/images/：
// 1) 开一个断网的测试副本（自己的临时存档、不连 Supabase、窗口看不见、不动鼠标键盘，不碰正在养的那只），
//    让狗按剧本动、逐帧截下来，再交给 tools/docs/make_gifs.py 拼成动图；几个姿势和表情拼成一张总图。
// 2) 写纸条、一起养、看看它、日记这几个小窗口，换上假数据的接口画出来截图（假名字、占位邀请码，不是真组里的）。
// 用法：node tools/docs/shots.mjs     要 Python 和 Pillow（pip install pillow）
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const IMAGES = path.join(ROOT, 'docs', 'images');
const FRAMES = path.join(ROOT, 'tools', 'out', 'docs', 'frames');
const STUB = path.join(ROOT, 'tools', 'docs', 'stub-preload.js');
const [MAIN_PORT, PAGE_PORT] = [9531, 9532];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[docs]', ...a);
fs.mkdirSync(IMAGES, { recursive: true });
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

// ---------- 开测试副本：临时存档、断网（联网配置指向一个不合格的地址，合养就不启动）、按 2 倍像素画 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-docs-'));
fs.writeFileSync(path.join(tmp, 'offline.json'), JSON.stringify({ url: 'offline', publishableKey: 'offline' }));
const proc = spawn(ELECTRON, [`--inspect=${MAIN_PORT}`, '.', `--remote-debugging-port=${PAGE_PORT}`, `--user-data-dir=${path.join(tmp, 'ud')}`, '--force-device-scale-factor=2'],
  { cwd: ROOT, env: { ...process.env, PET_E2E: '1', PET_SUPABASE_CONFIG: path.join(tmp, 'offline.json') }, stdio: 'ignore' });

async function connect(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return async expr => {
    const i = ++id;
    const r = await new Promise(res => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true } })); });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result ? r.result.value : r;
  };
}
async function target(port, pick) {
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const t = pick ? l.find(pick) : l[0]; if (t) return t.webSocketDebuggerUrl; } catch {}
    await sleep(500);
  }
  throw new Error('连不上测试副本的端口 ' + port);
}
const png = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));

// ---------- 页面里的小工具：从画布上截一块、按剧本逐帧走 ----------
const PAGE_LIB = String.raw`window.__docs = (() => {
  const R = window.__rig, gl = document.getElementById('gl'), ov = document.getElementById('ov'), stage = document.getElementById('stage');
  const dog = R.dog, world = R.world, ptr = R.ptr;
  const geo = () => { const r = stage.getBoundingClientRect(), dpr = gl.width / r.width; return { W: r.width, Hh: r.height, GY: r.height - 3, dpr, CT: r.height - gl.height / dpr }; };
  const PAPER = '#F6F0E6';
  // 画一个系统箭头光标（摸摸的时候让人看得出鼠标在哪）
  function cursor(x, cx, cy, s) {
    x.save(); x.translate(cx, cy); x.scale(s * 1.1, s * 1.1);
    x.beginPath(); x.moveTo(0, 0); x.lineTo(0, 17); x.lineTo(4.5, 13); x.lineTo(7.5, 19.5); x.lineTo(10, 18.4); x.lineTo(7.2, 12.2); x.lineTo(12.5, 12.2); x.closePath();
    x.fillStyle = '#fff'; x.fill(); x.lineWidth = 1.2; x.strokeStyle = '#222'; x.stroke(); x.restore();
  }
  // 把页面坐标 (x0, y0, w, h) 那一块画到新画布上
  function grab(b, bg, cur) {
    const g = geo(), c = document.createElement('canvas');
    c.width = Math.round(b[2] * g.dpr); c.height = Math.round(b[3] * g.dpr);
    const x = c.getContext('2d');
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
    const sx = b[0] * g.dpr, sy = (b[1] - g.CT) * g.dpr;
    x.drawImage(gl, sx, sy, c.width, c.height, 0, 0, c.width, c.height);
    x.drawImage(ov, sx, sy, c.width, c.height, 0, 0, c.width, c.height);
    if (cur) cursor(x, (cur[0] - b[0]) * g.dpr, (cur[1] - b[1]) * g.dpr, g.dpr);
    return c;
  }
  // 每次从同一个干净的状态开始：吃饱、精神好、碗挪远、不自己乱跑
  function reset(action, x, facing) {
    const g = geo();
    dog.auto = false; dog.manualUntil = 1e9; dog.userAway = false; dog.userIdle = 0; dog.held = false; dog.falling = false;
    dog.belly = .75; dog.needs.energy = 1; dog.expr = 'neutral'; dog.exprLock = false; dog.pet = 0; dog.once = null;
    world.food = 0; world.groundNote = null; world.bowlX = g.W * .92; world.bowlCarried = false;
    ptr.x = -999; ptr.y = -999; ptr.over = false; ptr.down = false;
    R.handleCommand({ type: 'action', value: 'idle' }); R.step(30, 1 / 30);
    dog.x = x; dog.facing = facing; dog.faceS = facing; dog.target = null;
    R.setAction(action, true); dog.actDur = 999; R.step(90, 1 / 30);
  }
  let U = 0;   // 站着时狗有多高（页面坐标），各个画面按它定大小
  function measure() { const g = geo(); reset('idle', g.W * .4, 1); U = dog.bbox[3] - dog.bbox[1]; return { U, g }; }
  const frames = [];
  const film = (b, cur) => frames.push(grab(b, PAPER, cur).toDataURL('image/png'));
  // 一段剧本截下来几百帧，一次全传回去太大：先存在页面里，脚本再一批一批取
  let kept = [];
  const take = () => { kept = frames.splice(0); return kept.length; };
  const pick = (i, n) => kept.slice(i, i + n);

  // 动图 1：溜达过去、掉头、走回来
  function walk() {
    const g = geo(), x0 = g.W * .4, dist = 1.6 * U, b = [x0 - 1.15 * U, g.GY - 1.22 * U, dist + 2.3 * U, 1.22 * U + 3];
    reset('idle', x0, 1);
    R.setAction('walk', true); dog.actDur = 999; dog.target = x0 + dist; dog.pause = 0;
    let phase = 0, hold = 0;
    for (let i = 0; i < 260; i++) {
      R.step(2, 1 / 30); film(b);
      if (phase === 0 && dog.target == null) { dog.target = x0; dog.pause = .5; phase = 1; }
      else if (phase === 1 && dog.target == null) { phase = 2; hold = 6; dog.pause = 99; }
      else if (phase === 2 && --hold <= 0) break;
    }
    return take();
  }
  // 动图 2：睡着 → 醒来伸懒腰
  function wake() {
    const g = geo(), x0 = g.W * .45, b = [x0 - 1.25 * U, g.GY - 1.22 * U, 2.5 * U, 1.22 * U + 3];
    reset('sleep', x0, 1); R.step(240, 1 / 30);
    for (let i = 0; i < 12; i++) { R.step(3, 1 / 30); film(b); }
    R.setAction('idle'); dog.actDur = 999;
    for (let i = 0; i < 70; i++) { R.step(3, 1 / 30); film(b); }
    return take();
  }
  // 动图 3：鼠标在头上来回划，它眯眼摇尾巴
  function petting() {
    const g = geo(), x0 = g.W * .45, b = [x0 - 1.25 * U, g.GY - 1.3 * U, 2.5 * U, 1.3 * U + 3];
    reset('sit', x0, -1);
    // 光标在头顶上来回划（狗朝左坐着，头顶在头框偏右的地方）
    const h = dog.parts.head, hw = (h[2] - h[0]) * .22, hx = (h[0] + h[2]) / 2 - dog.facing * (h[2] - h[0]) * .12, hy = h[1] + (h[3] - h[1]) * .1;
    for (let i = 0; i < 75; i++) {
      const p = [hx + Math.sin(i * .45) * hw, hy + Math.cos(i * .9) * 3];
      for (let k = 0; k < 2; k++) { ptr.x = p[0]; ptr.y = p[1]; ptr.over = true; ptr.movedAt = dog.t; ptr.speed = 320; R.step(1, 1 / 30); }
      film(b, i < 62 ? p : null);
      if (i === 62) { ptr.x = -999; ptr.y = -999; ptr.over = false; }
    }
    return take();
  }
  // 动图 4：倒一碗粮，走过去吃
  function eat() {
    const g = geo(), x0 = g.W * .4, b = [x0 - 1.2 * U, g.GY - 1.22 * U, 3.9 * U, 1.22 * U + 3];
    reset('idle', x0, 1); world.bowlX = x0 + 2.2 * U; R.step(10, 1 / 30);
    dog.belly = .2; R.handleCommand({ type: 'feed' }); dog.auto = false;
    for (let i = 0; i < 12; i++) { R.step(2, 1 / 30); film(b); }
    R.setAction('eat', true); dog.actDur = 999;
    for (let i = 0; i < 80; i++) { R.step(2, 1 / 30); film(b); }
    return take();
  }
  // 动图 5：叼着纸条出门
  function courier() {
    const g = geo(), x0 = g.W * .82, b = [x0 - 1.4 * U, g.GY - 1.22 * U, 3.6 * U, 1.22 * U + 3];
    reset('idle', x0, 1); world.bowlX = g.W * .1;
    R.handleCommand({ type: 'note', value: '晚上一起吃饭吗？' }); dog.auto = false;
    for (let i = 0; i < 75; i++) { R.step(2, 1 / 30); film(b); if (dog.bbox && dog.bbox[0] > b[0] + b[2] + 20) break; }
    return take();
  }

  // 静态总图里的一格：摆好以后截狗周围一块（透明底）
  function cell(setup) {
    const g = geo(); setup(g);
    const bb = dog.bbox, cx = (bb[0] + bb[2]) / 2, w = 2.3 * U, h = 1.45 * U;
    const top = Math.min(g.GY + 3 - h, bb[1] - .12 * U);
    return grab([cx - w / 2, top, w, h]);
  }
  const POSES = [
    ['溜达', g => { reset('idle', g.W * .4, 1); R.setAction('walk', true); dog.actDur = 999; dog.target = g.W * .7; dog.pause = 0; R.step(40, 1 / 30); }],
    ['东闻西闻', g => { reset('sniff', g.W * .4, -1); }],
    ['坐着发呆', g => { reset('sit', g.W * .4, 1); }],
    ['趴着', g => { reset('lie', g.W * .4, -1); }],
    ['睡觉', g => { reset('sleep', g.W * .4, 1); R.step(200, 1 / 30); }],
    ['找你玩', g => { reset('bow', g.W * .4, -1); }],
    ['吃饭', g => { reset('idle', g.W * .4, 1); world.bowlX = g.W * .4 + 1.1 * U; dog.belly = .2; world.food = 1; R.setAction('eat', true); dog.actDur = 999; R.step(150, 1 / 30); }],
    ['饿了等饭', g => { reset('idle', g.W * .4, 1); world.bowlX = g.W * .4 + 1.3 * U; dog.belly = .1; R.setAction('hungry', true); dog.actDur = 999; R.step(200, 1 / 30); }],
    ['叼着纸条', g => { reset('idle', g.W * .4, 1); R.handleCommand({ type: 'note', value: '嗨' }); dog.auto = false; R.step(130, 1 / 30); dog.x = g.W * .4; R.step(1, 1 / 30); }],
    ['拎久了不乐意', g => { reset('idle', g.W * .4, -1); dog.held = true; dog.heldT = dog.t; dog.gdx = 0; dog.gdy = 0; ptr.x = dog.x; ptr.y = g.GY - .9 * U; ptr.down = true; R.step(110, 1 / 30); }],
    ['开心', g => { reset('sit', g.W * .4, -1); dog.expr = 'happy'; dog.exprLock = true; R.step(60, 1 / 30); }],
    ['委屈', g => { reset('lie', g.W * .4, 1); dog.expr = 'sad'; dog.exprLock = true; R.step(60, 1 / 30); }]
  ];
  // 把十二格拼成一张：每格一张浅色卡片，下面一行手写字
  async function sheet() {
    await document.fonts.load('40px PetHand');
    const cells = POSES.map(([label, setup]) => [label, cell(setup)]);
    ptr.down = false; dog.held = false;
    const cw = cells[0][1].width, ch = cells[0][1].height, s = 360 / cw, cardW = 360, cardH = Math.round(ch * s) + 62, gap = 22, cols = 4, rows = 3;
    const c = document.createElement('canvas'); c.width = cols * cardW + (cols - 1) * gap; c.height = rows * cardH + (rows - 1) * gap;
    const x = c.getContext('2d');
    cells.forEach(([label, img], i) => {
      const cx = (i % cols) * (cardW + gap), cy = Math.floor(i / cols) * (cardH + gap);
      x.fillStyle = PAPER; x.beginPath(); x.roundRect(cx, cy, cardW, cardH, 18); x.fill();
      x.drawImage(img, cx, cy + 6, cardW, Math.round(ch * s));
      x.fillStyle = '#5A4434'; x.font = '30px PetHand'; x.textAlign = 'center'; x.fillText(label, cx + cardW / 2, cy + cardH - 22);
    });
    return c.toDataURL('image/png');
  }
  // 顶部横幅：左边标题，右边狗坐在碗旁边
  async function banner() {
    await document.fonts.load('80px PetHand');
    const g = geo(), x0 = g.W * .55;
    reset('sit', x0, -1); world.bowlX = x0 + 1.05 * U; world.food = 1; R.step(30, 1 / 30);
    dog.expr = 'happy'; dog.exprLock = true; R.step(40, 1 / 30);
    const pic = grab([x0 - 1.0 * U, g.GY - 1.3 * U, 2.6 * U, 1.3 * U + 3]);
    const c = document.createElement('canvas'), Wd = 1200, Hd = 330; c.width = Wd; c.height = Hd;
    const x = c.getContext('2d'), grad = x.createLinearGradient(0, 0, Wd, Hd);
    grad.addColorStop(0, '#F7EEDF'); grad.addColorStop(1, '#E6EEF2');
    x.fillStyle = grad; x.beginPath(); x.roundRect(0, 0, Wd, Hd, 28); x.fill();
    x.fillStyle = 'rgba(90,68,52,.10)'; x.fillRect(0, Hd - 40, Wd, 2);
    const ph = Hd - 30, pw = pic.width * ph / pic.height;
    x.drawImage(pic, Wd - pw - 50, Hd - 38 - ph + 14, pw, ph);
    x.fillStyle = '#4A3426'; x.font = '72px PetHand'; x.fillText('桌面比格', 66, 142);
    x.fillStyle = '#7A6352'; x.font = '29px PetHand'; x.fillText('住在桌面上的小比格，可以和朋友一起养', 69, 198);
    dog.exprLock = false;
    return c.toDataURL('image/png');
  }
  // 远程"看看它"里那张小图：和程序里一样，最大 240×180
  function snapshot() {
    const g = geo(); reset('sniff', g.W * .4, 1);
    const bb = dog.bbox, pad = 16 * dog.k, b = [bb[0] - pad, bb[1] - pad * 2, bb[2] - bb[0] + pad * 2, bb[3] - bb[1] + pad * 2.5];
    const src = grab(b), s = Math.min(1, 240 / src.width, 180 / src.height), c = document.createElement('canvas');
    c.width = Math.round(src.width * s); c.height = Math.round(src.height * s); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  return { pick, measure, walk, wake, petting, eat, courier, sheet, banner, snapshot };
})(); true`;

// ---------- 小窗口：换上假数据的接口，截图 ----------
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
function fakeData(snapshotImg) {
  const now = Date.now(), at = (d, h, m) => { const t = new Date(now - d * DAY); t.setHours(h, m, 0, 0); return t.getTime(); };
  const members = [
    { id: 'm1', me: true, nickname: '', status: 'active', present: true },
    { id: 'm2', nickname: '小林', status: 'active', present: true },
    { id: 'm3', nickname: '阿杰', status: 'active', present: false }
  ];
  return {
    'together-start': { view: { mode: 'none' } },
    'together': { view: { mode: 'ready', here: false, traveling: false, onMyOther: false, host: { nickname: '小林' }, canCall: true, doing: '在闻来闻去', kept: false,
      pending: [{ id: 'p1', nickname: '小周' }], claims: [], kicks: [], members, canKick: true, code: 'ABCD-EFGH-JKMN' } },
    'note': { info: { mode: 'ready', here: true, hostName: '', others: [{ id: 'm2', nickname: '小林', present: true }, { id: 'm3', nickname: '阿杰', present: false }] }, text: '@小林 晚上一起吃饭吗？' },
    'watch': { frame: { here: false, onMyOther: false, traveling: false, hostName: '小林', doing: '在闻来闻去', kept: false, img: snapshotImg, canFeed: true, canCall: true } },
    'diary': { diary: [
      { at: at(9, 20, 14), text: '开始记日记' }, { at: at(9, 20, 14), text: '第一天来到这里' },
      { at: at(8, 12, 30), text: '开始和朋友一起养它' },
      { at: at(4, 10, 5), text: '不饿也老往碗边凑，是个小馋鬼' },
      { at: at(2, 9, 0), text: '来这儿 7 天了' },
      { at: at(1, 15, 2), text: '去 小林 那儿串门了' }, { at: at(1, 18, 22), text: '小林 托它带来一张纸条' }, { at: at(1, 21, 47), text: '最近有点圆了' },
      { at: at(0, 11, 36), text: '阿杰 隔空喂了它一碗' }, { at: at(0, 14, 8), text: '特别黏人，一会儿没人理就来找' }
    ] }
  };
}
const WINDOWS = [
  ['together-start', 'together.html', 400, 400],
  ['together', 'together.html', 400, 400],
  ['note', 'note.html', 400, 330],
  ['watch', 'watch.html', 320, 330],
  ['diary', 'diary.html', 380, 440]
];

let ok = false;
try {
  const M = await connect(await target(MAIN_PORT));
  const P = await connect(await target(PAGE_PORT, t => /index\.html/.test(t.url)));
  for (let i = 0; i < 60 && !(await P('!!(window.__rig && window.__rig.dog && window.__rig.dog.bbox)')); i++) await sleep(500);
  await P(PAGE_LIB);
  const { U, g } = await P('window.__docs.measure()');
  log(`页面 ${Math.round(g.W)}x${Math.round(g.Hh)}，${g.dpr} 倍像素，狗站着高 ${Math.round(U * g.dpr)} 像素`);

  for (const scene of ['walk', 'wake', 'petting', 'eat', 'courier']) {
    const n = await P(`window.__docs.${scene}()`);
    const dir = path.join(FRAMES, scene); fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < n; i += 8) (await P(`window.__docs.pick(${i}, 8)`)).forEach((f, k) => png(path.join(dir, String(i + k).padStart(3, '0') + '.png'), f));
    log(`${scene}：${n} 帧`);
  }
  png(path.join(IMAGES, 'poses.png'), await P('window.__docs.sheet()'));
  png(path.join(IMAGES, 'banner.png'), await P('window.__docs.banner()'));
  const snap = await P('window.__docs.snapshot()');
  log('姿势总图、横幅好了');

  // 小窗口：主进程里开一个看不见的窗口，预加载换成假接口（数据放临时文件，路径从命令行传过去）
  const data = fakeData(snap);
  for (const [name, page, w, h] of WINDOWS) {
    const file = path.join(tmp, name + '.json');
    fs.writeFileSync(file, JSON.stringify(data[name]));
    const b64 = await M(`(async () => {
      const { BrowserWindow } = process.mainModule.require('electron');
      const w = new BrowserWindow({ width: ${w}, height: ${h}, frame: false, transparent: true, backgroundColor: '#00000000', show: false, skipTaskbar: true, focusable: false,
        webPreferences: { preload: ${JSON.stringify(STUB)}, contextIsolation: false, sandbox: false, additionalArguments: ['--doc-data=' + ${JSON.stringify(file)}] } });
      w.setOpacity(0); w.setIgnoreMouseEvents(true);
      await w.loadFile(${JSON.stringify(path.join(ROOT, 'src', 'renderer', page))});
      w.showInactive();
      await w.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 900)))');
      const img = await w.webContents.capturePage();
      w.destroy();
      return img.toPNG().toString('base64');
    })()`);
    fs.writeFileSync(path.join(IMAGES, `win-${name}.png`), Buffer.from(b64, 'base64'));
    log(`窗口 ${name} 好了`);
  }

  // 拼动图
  const py = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(ROOT, 'tools', 'docs', 'make_gifs.py'), FRAMES, IMAGES], { stdio: 'inherit' });
  if (py.status !== 0) throw new Error('拼动图失败');
  ok = true;
} catch (e) {
  console.error('[docs] 出错：', e.message);
} finally {
  try { proc.kill(); } catch {}
  await sleep(800);
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
