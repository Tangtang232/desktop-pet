// 从 0.1.0 升级到新版：旧版本开两台（A、B）建一个两人组，再把 A 换成新打的打包版（同一份存档），真连 Supabase。
// 看：还在组里、身份不变、狗的生日和脾气不变、新版认出"已经开始一起养"、认领钥匙交上了；旧版 B 照常用。最后两人都退出，组散掉。
// 用法：先 npm run dist（或 dist:dir），再 PET_OLD=<0.1.0 源码目录> node tools/e2e/upgrade-real.mjs     约 1 分半
// 0.1.0 的源码目录可以这样准备：git worktree add --detach <目录> v0.1.0，再把 node_modules 链过去（mklink /J）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OLD = process.env.PET_OLD && path.resolve(process.env.PET_OLD);
const EXE = process.env.PET_EXE || path.join(ROOT, 'dist', 'win-unpacked', 'DesktopPet.exe');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!OLD || !fs.existsSync(path.join(OLD, 'package.json'))) { console.error('要用 PET_OLD 指定 0.1.0 的源码目录'); process.exit(2); }
if (!fs.existsSync(EXE)) { console.error(`没找到 ${EXE}，先 npm run dist`); process.exit(2); }
const PORTS = { A: [9631, 9632], B: [9641, 9642] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const results = [];
const check = (name, pass, info) => { results.push({ name, pass: !!pass }); log(pass ? '✔' : '✘', name, info == null ? '' : JSON.stringify(info).slice(0, 240)); };
async function until(fn, ms, every = 500) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(every); } return v; }

async function connect(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const ev = async expr => {
    const i = ++id;
    const r = await new Promise(res => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true, timeout: 60000 } })); });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    if (!r.result) throw new Error(JSON.stringify(r).slice(0, 200));
    return r.result.value;
  };
  ev.close = () => ws.close();
  return ev;
}
async function target(port, pick) {
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const t = pick ? l.find(pick) : l[0]; if (t) return t.webSocketDebuggerUrl; } catch {}
    await sleep(300);
  }
  throw new Error('连不上 ' + port);
}
const procs = {}, dirs = {}, M = {}, P = {};
async function launch(k, which) {
  const [mp, pp] = PORTS[k];
  const args = [`--inspect=${mp}`, `--remote-debugging-port=${pp}`, `--user-data-dir=${dirs[k]}`];
  procs[k] = which === 'old'
    ? spawn(ELECTRON, [args[0], '.', ...args.slice(1)], { cwd: OLD, env: { ...process.env, PET_E2E: '1' }, stdio: 'ignore' })
    : spawn(EXE, args, { env: { ...process.env, PET_E2E: '1' }, stdio: 'ignore' });
  M[k] = await connect(await target(mp));
  P[k] = await connect(await target(pp, t => t.type === 'page' && /index\.html/.test(t.url)));
}
async function stop(k) { const p = procs[k]; if (!p) return; p.kill(); await new Promise(r => p.once('exit', r)); procs[k] = null; await sleep(800); }
const T = 'global.__petMain.together';
const view = k => M[k](`${T}.view(true)`);
const dbg = k => M[k](`${T}._debug()`);
const page = (k, e) => P[k](`(() => { const R = window.__rig; return ${e}; })()`);

try {
  for (const k of Object.keys(PORTS)) { dirs[k] = fs.mkdtempSync(path.join(os.tmpdir(), `pet-upgrade-${k}-`)); await launch(k, 'old'); }
  check('两台都是 0.1.0，连上服务器', !!(await until(async () => (await view('A')).mode === 'none' && (await view('B')).mode === 'none', 40000)));

  // 1) 0.1.0 建两人组
  const created = await M.A(`${T}.createPet('')`);
  const jb = await M.B(`${T}.joinPet(${JSON.stringify(created.code)}, '')`);
  const ask = await until(async () => { const v = await view('A'); return v.pending.length ? v : null; }, 30000);
  await M.A(`${T}.approve(${JSON.stringify(ask.pending[0].id)}, true)`);
  const both = await until(async () => (await view('B')).mode === 'ready', 30000);
  check('0.1.0 的两台建好了两人组', created.ok && jb.ok && !!both);
  await sleep(17000);   // 等 A 存一次档
  const before = { me: (await dbg('A')).me, born: await page('A', 'R.grow.born'), seed: await page('A', 'JSON.stringify(R.grow.seed || R.traits)') };
  check('记下 A 升级前的身份和狗', !!before.me && !!before.born, { born: before.born });

  // 2) A 换成新版（同一份存档）
  await stop('A');
  await launch('A', 'new');
  const vA = await until(async () => { const v = await view('A'); return v.mode === 'ready' ? v : null; }, 40000);
  check('升级后打开：还在原来的组里', !!vA, vA && vA.mode);
  const dA = await dbg('A');
  check('身份没变（同一个成员）', dA.me === before.me);
  check('新版认出已经开始一起养（不是"等朋友加入"）', !!vA && vA.alone === false && vA.started === true, vA && { alone: vA.alone, started: vA.started });
  const after = { born: await until(() => page('A', 'R.grow.born'), 20000), seed: await page('A', 'JSON.stringify(R.grow.seed || R.traits)') };
  check('狗还是那只（生日、脾气都没变）', after.born === before.born && after.seed === before.seed, { before: before.born, after: after.born });
  check('认领钥匙交上了（以后登录丢了能自己认回来）', !!(await until(async () => (await dbg('A')).recovery, 30000, 1000)));
  const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(dirs.A, 'together.json'), 'utf8')));
  check('本机保险箱多了新版的几项（uid、recovery）', ['uid', 'recovery', 'recoveryFor'].every(k => keys.includes(k)), keys.filter(k => !k.startsWith('auth:')));

  // 3) 旧版 B 照常用：看得到 A，两个人都在
  await M.B(`${T}.refresh()`);
  const vB = await view('B');
  check('0.1.0 的 B 照常用，组里还是两个人', vB.mode === 'ready' && vB.members.filter(m => m.status === 'active').length === 2, { mode: vB.mode, n: vB.members.length });

  // 4) 收尾：都退出，组散掉
  const lb = await M.B(`${T}.leave()`), la = await M.A(`${T}.leave()`);
  check('都退出，组散了', lb.ok && la.ok && la.status === 'gone', { b: lb.status, a: la.status });
} catch (err) {
  check('测试没跑完', false, err.message);
} finally {
  for (const k of Object.keys(PORTS)) { try { procs[k] && procs[k].kill(); } catch {} }
  await sleep(1500);
  for (const d of Object.values(dirs)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}
const ok = results.filter(r => r.pass).length;
console.log(`\n0.1.0 升级到新版：${ok} / ${results.length} 通过`);
process.exit(ok === results.length ? 0 : 1);
