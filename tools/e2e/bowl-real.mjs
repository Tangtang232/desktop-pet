// 真鼠标拖碗：鼠标移到碗上 → 按住往左（或往右）拖 300 像素 → 松开，看碗挪过去、落回地上没有。
// 会移动你的鼠标，跑的时候别碰鼠标。准备方式和 drag-real.mjs 一样（测试模式开一只，9400 / 9401 两个调试端口）。
// 用法：node tools/e2e/bowl-real.mjs [次数，默认 5]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const koffi = require('koffi');
const N = Number(process.argv.slice(2).find(a => /^[0-9]+$/.test(a))) || 5, MAIN = 9401, PAGE = 9400;
const u32 = koffi.load('user32.dll');
u32.func('SetProcessDpiAwarenessContext', 'bool', ['intptr_t'])(-4);
const POINT = koffi.struct('BR_POINT', { x: 'int32_t', y: 'int32_t' });
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
  if (!t) throw new Error(`连不上调试端口 ${port}`);
  const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result || m.error); p.delete(m.id); } };
  await new Promise(r => ws.onopen = r);
  return async expr => { const i = ++id; const r = await new Promise(res => { p.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result ? r.result.value : r; };
}
const main = await conn(MAIN), page = await conn(PAGE, t => t.type === 'page' && /index\.html/.test(t.url));
const toScreen = (x, y) => main(`(() => { const { screen } = process.mainModule.require('electron'); const wa = screen.getPrimaryDisplay().workArea; return screen.dipToScreenPoint({ x: Math.round(wa.x + ${x}), y: Math.round(wa.y + ${y}) }); })()`);
const orig = {}; GetCursorPos(orig);
// 测试自己也不能干扰别的程序：要点的位置被别的窗口盖着时不点（点下去会落进那个程序里），等一下再看；一直盖着就停下
const blockedAt = (x, y) => main(`(() => { const { screen } = process.mainModule.require('electron'); const wa = screen.getPrimaryDisplay().workArea; const l = global.__petMain && global.__petMain.layer; return l ? l.pointBlocked(wa.x + ${x}, wa.y + ${y}) : false; })()`);
let blockedTries = 0;
async function clearToClick(x, y) {
  if (!(await blockedAt(x, y))) { blockedTries = 0; return true; }
  if (++blockedTries > 5) { console.log('\n要点的位置一直被别的窗口盖着，停下了：先让狗露出来（比如把盖着它的窗口挪开）再跑'); moveAbs(orig.x, orig.y); process.exit(2); }
  process.stdout.write('□'); await sleep(1000); return false;
}
const bowlSaved = await page('__rig.world.bowlN');
let ok = 0, interfered = 0; const fails = [];
for (let i = 0; i < N; i++) {
  // 狗先挪开，别挡着碗
  const s0 = await page(`(() => { const R = __rig, r = R.bowlRect(); R.handleCommand({ type: 'action', value: 'idle' }); R.dog.x = Math.max(80, Math.min(R.world.bowlX > 900 ? 300 : 1500, 1900)); return { r: r.map(Math.round), bx: Math.round(R.world.bowlX), W: innerWidth }; })()`);
  await sleep(500);
  const r = s0.r, cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, dir = s0.bx > s0.W / 2 ? -1 : 1;
  if (!(await clearToClick(cx, cy))) { i--; continue; }
  const a = await toScreen(cx, cy), b = await toScreen(cx + dir * 300, cy - 60);
  moveAbs(a.x, a.y); await sleep(250); moveAbs(a.x + 2, a.y); await sleep(250);
  mouse_event(0x0002, 0, 0, 0, 0); await sleep(90);
  const steps = 15;
  for (let k = 1; k <= steps; k++) { moveAbs(a.x + (b.x - a.x) * k / steps, a.y + (b.y - a.y) * k / steps); await sleep(25); }
  await sleep(150);
  const touched = !cursorAt(b.x, b.y);
  const mid = await page(`({ held: __rig.world.bowlHeld, x: Math.round(__rig.world.bowlX) })`);
  mouse_event(0x0004, 0, 0, 0, 0); await sleep(1200);
  if (touched && !mid.held){ interfered++; if (interfered <= 10){ i--; process.stdout.write('·'); continue; } }
  const end = await page(`({ held: __rig.world.bowlHeld, falling: __rig.world.bowlFalling, x: Math.round(__rig.world.bowlX), n: __rig.world.bowlN, dogHeld: __rig.dog.held })`);
  const moved = Math.abs(end.x - s0.bx);
  const pass = mid.held && !end.held && !end.falling && !end.dogHeld && moved > 220 && end.n != null;
  if (pass) ok++; else fails.push({ i, start: s0.bx, mid, end });
  process.stdout.write(pass ? '✔' : '✘');
}
moveAbs(orig.x, orig.y);
await page(`(() => { __rig.world.bowlN = ${JSON.stringify(bowlSaved)}; __rig.resize(); return 1; })()`);   // 碗放回测之前的位置
if (interfered) console.log(`\n（有 ${interfered} 次鼠标被人同时动了，那几次不算，重测了）`);
console.log(`\n真鼠标拖碗：${ok} / ${N} 次挪过去、落回地上了`);
if (fails.length) console.log(JSON.stringify(fails, null, 1));
process.exit(fails.length ? 1 : 0);
