// 真鼠标拖狗的回归测试：在真桌面上用系统鼠标反复拖狗，统计拎起来没有、"按下"被吃掉几次。
// 会移动你的鼠标，跑的时候别碰鼠标。只能在 Windows 上跑。
//
// 先用测试模式开一只（会用到 9400 / 9401 两个调试端口）：
//   $env:PET_E2E='1'; electron --inspect=9401 . --remote-debugging-port=9400
// 再跑：node tools/e2e/drag-real.mjs [次数，默认 20]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const koffi = require('koffi');
const N = Number(process.argv.slice(2).find(a => /^[0-9]+$/.test(a))) || 20, MAIN = 9401, PAGE = 9400;
const u32 = koffi.load('user32.dll');
u32.func('SetProcessDpiAwarenessContext', 'bool', ['intptr_t'])(-4);
const POINT = koffi.struct('DR_POINT', { x: 'int32_t', y: 'int32_t' });
const mouse_event = u32.func('mouse_event', 'void', ['uint32_t', 'int32_t', 'int32_t', 'int32_t', 'uintptr_t']);
const GetSystemMetrics = u32.func('GetSystemMetrics', 'int', ['int']);
const GetCursorPos = u32.func('GetCursorPos', 'bool', [koffi.out(koffi.pointer(POINT))]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VX = GetSystemMetrics(76), VY = GetSystemMetrics(77), VW = GetSystemMetrics(78), VH = GetSystemMetrics(79);
const moveAbs = (x, y) => mouse_event(0x8001 | 0x4000, Math.round((x - VX) * 65535 / (VW - 1)), Math.round((y - VY) * 65535 / (VH - 1)), 0, 0);
// 鼠标是不是还在刚放的位置：不在就是有人同时在动鼠标，这一次不算
const cursorAt = (x, y) => { const p = {}; GetCursorPos(p); return Math.abs(p.x - x) <= 3 && Math.abs(p.y - y) <= 3; };
async function conn(port, pick) {
  let t;
  for (let i = 0; i < 40 && !t; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); t = pick ? l.find(pick) : l[0]; } catch {} if (!t) await sleep(500); }
  if (!t) throw new Error(`连不上调试端口 ${port}，先按文件开头的说明用测试模式开一只`);
  const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result || m.error); p.delete(m.id); } };
  await new Promise(r => ws.onopen = r);
  return async expr => { const i = ++id; const r = await new Promise(res => { p.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result ? r.result.value : r; };
}
const main = await conn(MAIN), page = await conn(PAGE, t => t.type === 'page' && /index\.html/.test(t.url));
const E = "process.mainModule.require('electron')";
const toScreen = (x, y) => main(`(() => { const { screen } = ${E}; const wa = screen.getPrimaryDisplay().workArea; return screen.dipToScreenPoint({ x: Math.round(wa.x + ${x}), y: Math.round(wa.y + ${y}) }); })()`);
const st = () => page(`({ action: __rig.dog.action, held: __rig.dog.held, falling: __rig.dog.falling, moving: __rig.dog.moving, visible: __rig.dog.visible, abroad: !!__rig.dog.abroad, bbox: __rig.dog.bbox && __rig.dog.bbox.map(Math.round), ring: __rig.inputRing.length })`);
const orig = {}; GetCursorPos(orig);
// 测试自己也不能干扰别的程序：要点的位置被别的窗口盖着时不点（点下去会落进那个程序里），等一下再看；一直盖着就停下
const blockedAt = (x, y) => main(`(() => { const { screen } = process.mainModule.require('electron'); const wa = screen.getPrimaryDisplay().workArea; const l = global.__petMain && global.__petMain.layer; return l ? l.pointBlocked(wa.x + ${x}, wa.y + ${y}) : false; })()`);
let blockedTries = 0;
async function clearToClick(x, y) {
  if (!(await blockedAt(x, y))) { blockedTries = 0; return true; }
  if (++blockedTries > 5) { console.log('\n要点的位置一直被别的窗口盖着，停下了：先让狗露出来（比如把盖着它的窗口挪开）再跑'); moveAbs(orig.x, orig.y); process.exit(2); }
  process.stdout.write('□'); await sleep(1000); return false;
}
// --eat：假装页面自己的"按下"全被吃掉，只靠主进程盯键那一路（验证兜底）
const EAT = process.argv.includes('--eat');
await page(`window.__dropDomDown = ${EAT}; 1`);
// 碗放回默认位置（之前的测试可能把它挪到了狗常走的地方），测完再放回去
const bowlSaved = await page(`(() => { const n = __rig.world.bowlN; __rig.world.bowlN = null; __rig.resize(); return n; })()`);
let interfered = 0;
let ok = 0, eaten = 0; const fails = [];
for (let i = 0; i < N; i++) {
  // 一半趁它停着拖，一半趁它在走路时拖
  const wantWalk = i % 2 === 1;
  await page(`(() => { const R = __rig; R.dog.auto = true; R.dog.manualUntil = 0; R.handleCommand({ type: 'action', value: ${wantWalk ? "'walk'" : "'idle'"} }); R.dog.manualUntil = performance.now() / 1000 + 30; return 1; })()`);
  // 狗别挨着碗：挨着就先挪开（按在腿缝里时会按到碗上）。挪完要等它画几帧，位置才是新的
  await page(`(() => { const R = __rig, d = R.dog; if (Math.abs(d.x - R.world.bowlX) < 400){ d.x = innerWidth * .3; d.target = null; } return 1; })()`);
  await sleep(wantWalk ? 1200 : 900);
  let s = await st();
  for (let k = 0; k < 20 && (!s.visible || s.abroad || s.falling || !s.bbox); k++) { await sleep(300); s = await st(); }
  const b = s.bbox, c = await toScreen((b[0] + b[2]) / 2, b[1] + (b[3] - b[1]) * .55);
  const ring0 = s.ring;
  if (!(await clearToClick((b[0] + b[2]) / 2, b[1] + (b[3] - b[1]) * .55))) { i--; continue; }
  moveAbs(c.x, c.y); await sleep(250); moveAbs(c.x + 2, c.y); await sleep(250);
  mouse_event(0x0002, 0, 0, 0, 0); await sleep(90);
  for (let k = 1; k <= 12; k++) { moveAbs(c.x + 2 + k * 5, c.y - k * 10); await sleep(22); }
  const touched = !cursorAt(c.x + 2 + 60, c.y - 120);
  const mid = await st();
  mouse_event(0x0004, 0, 0, 0, 0); await sleep(1300);
  if (touched && !mid.held){ interfered++; if (interfered <= 10){ i--; process.stdout.write('·'); continue; } }
  const log = await page(`__rig.inputRing.slice(-12).map(r => r[1] + (r[2] ? ':' + r[2] : '')).join(' ')`);
  const missing = (await page(`__rig.inputRing.slice(-12).filter(r => r[1] === 'dom-down-missing').length`));
  if (missing) eaten++;
  if (mid.held) ok++; else fails.push({ i, walking: wantWalk, before: s.action, mid, log });
  process.stdout.write(mid.held ? '✔' : '✘');
}
moveAbs(orig.x, orig.y);
await page('window.__dropDomDown = false; 1');
await page(`(() => { __rig.world.bowlN = ${JSON.stringify(bowlSaved)}; __rig.resize(); return 1; })()`);
if (interfered) console.log(`
（有 ${interfered} 次鼠标被人同时动了，那几次不算，重测了）`);
console.log(`\n真鼠标拖狗${EAT ? '（假装页面自己的按下全被吃掉）' : ''}：${ok} / ${N} 次拎起来了；其中 ${eaten} 次页面自己没收到"按下"，靠主进程那一路接住`);
if (fails.length) console.log('没拎起来的：', JSON.stringify(fails, null, 1));
process.exit(fails.length ? 1 : 0);
