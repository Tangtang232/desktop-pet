// 朋友视角的全流程：两个打包好的程序（dist/win-unpacked）当两台刚装好的电脑，真连 Supabase，看不见、不动鼠标。
// 第一次打开 → 托盘菜单 → 检查新版本 → 复制诊断信息 → 发起邀请（还没开始一起养）→ 对方输码申请 → 同意、开始一起养
// → 写纸条让狗叼过去、对方收到看完 → 对方退出（回到等朋友加入）→ 不邀请了（组散掉，不留测试组，匿名账号会留下）
// 用法：先 npm run dist（或 dist:dir），再 node tools/e2e/journey-real.mjs     约 3 分钟
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXE = process.env.PET_EXE || path.join(ROOT, 'dist', 'win-unpacked', 'DesktopPet.exe');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const PORTS = { A: [9611, 9612], B: [9621, 9622] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const results = [];
const check = (name, pass, info) => { results.push({ name, pass: !!pass }); log(pass ? '✔' : '✘', name, info == null ? '' : JSON.stringify(info).slice(0, 240)); };
async function until(fn, ms, every = 500) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(every); } return v; }

if (!fs.existsSync(EXE)) { console.error(`没找到 ${EXE}，先 npm run dist`); process.exit(2); }
const procs = {}, dirs = {}, out = { A: '', B: '' };
for (const [k, [mp, pp]] of Object.entries(PORTS)) {
  dirs[k] = fs.mkdtempSync(path.join(os.tmpdir(), `pet-journey-${k}-`));
  procs[k] = spawn(EXE, [`--inspect=${mp}`, `--remote-debugging-port=${pp}`, `--user-data-dir=${dirs[k]}`],
    { env: { ...process.env, PET_E2E: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs[k].stdout.on('data', d => { out[k] += d.toString('utf8'); });
}
// 测试副本没有托盘，托盘提示会打到主进程的输出里："[main] 提示: ……"
const balloons = k => out[k].split('\n').filter(l => l.includes('[main] 提示:')).map(l => l.split('[main] 提示:')[1].trim());

async function connect(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return async expr => {
    const i = ++id;
    const r = await new Promise(res => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true, timeout: 60000 } })); });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    if (!r.result) throw new Error(JSON.stringify(r).slice(0, 200));
    return r.result.value;
  };
}
async function target(port, pick) {
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const t = pick ? l.find(pick) : l[0]; if (t) return t.webSocketDebuggerUrl; } catch {}
    await sleep(300);
  }
  throw new Error('连不上 ' + port);
}
const M = {}, P = {};
const T = 'global.__petMain.together';
const view = k => M[k](`${T}.view(true)`);
const page = (k, e) => P[k](`(() => { const R = window.__rig; return ${e}; })()`);
const menu = k => M[k](`global.__petMain.buildMenu().items.map(i => ({ label: i.label, sub: i.submenu ? i.submenu.items.map(s => s.label) : null })).filter(i => i.label)`);
const winText = (k, w) => M[k](`(async () => { const x = global.__petMain.${w}; if (!x || x.isDestroyed()) return ''; await new Promise(r => setTimeout(r, 400)); return x.webContents.executeJavaScript("document.getElementById('main') ? document.getElementById('main').innerText : document.body.innerText"); })()`);
const readJson = (k, f) => { try { return JSON.parse(fs.readFileSync(path.join(dirs[k], f), 'utf8')); } catch { return null; } };

try {
  for (const k of Object.keys(PORTS)) {
    M[k] = await connect(await target(PORTS[k][0]));
    P[k] = await connect(await target(PORTS[k][1], t => t.type === 'page' && /index\.html/.test(t.url)));
  }

  // 1) 第一次打开
  const ready = await until(async () => { const vs = await Promise.all(['A', 'B'].map(view)); return vs.every(v => v.mode === 'none') && vs; }, 40000);
  check('装好打开：连上服务器（匿名登录），还没在任何组里', !!ready, ready && ready.map(v => v.mode));
  check('桌面上有狗', !!(await until(() => page('A', 'R && R.dog.visible'), 20000)));
  const hello = await until(() => balloons('A').find(b => b.includes('我住在桌面最底下')), 15000);
  check('第一次打开提示右键能干什么', !!hello, hello);
  check('提示过就记下了，下次不再提示', !!(readJson('A', 'settings.json') || {}).welcomed);

  // 2) 托盘菜单
  const mA = await menu('A');
  const about = mA.find(i => /^关于/.test(i.label));
  check('托盘菜单有「一起养…」', mA.some(i => i.label === '一起养…'), mA.map(i => i.label));
  check(`「关于」里是版本 ${VERSION}、项目主页、检查新版本、复制诊断信息`, !!about && about.label.includes(VERSION) && ['打开项目主页', '检查新版本'].every(s => about.sub.includes(s)) && about.sub.some(s => s.includes('复制诊断信息')), about);

  // 3) 检查新版本（GitHub 上最新的就是这一版）
  const up = await M.A(`global.__petMain.updater.check(true)`);
  const upMsg = await until(() => balloons('A').find(b => b.includes('最新版本') || b.includes('新版本')), 10000);
  check('检查新版本：已经是最新的', up.ok && !up.latest && /已经是最新版本/.test(upMsg || ''), { up, upMsg });

  // 4) 复制诊断信息（换掉剪贴板写入，不碰你真的剪贴板）
  const diagText = await M.A(`(() => { const c = process.mainModule.require('electron').clipboard; const w = c.writeText; let got = null; c.writeText = t => { got = t; };
    try { const it = global.__petMain.buildMenu().items.find(i => i.submenu && /关于/.test(i.label)).submenu.items.find(s => /诊断/.test(s.label)); it.click(); } finally { c.writeText = w; } return got; })()`);
  check('复制诊断信息：有版本和一起养的状态', typeof diagText === 'string' && diagText.includes(`桌面比格 ${VERSION}`) && diagText.includes('一起养：none'), (diagText || '').split('\n').slice(0, 3));
  check('诊断信息里没有用户名路径', typeof diagText === 'string' && !diagText.includes(os.homedir()) && !diagText.includes(os.homedir().replace(/\\/g, '\\\\')));

  // 5) A 发起邀请：还只是邀请，没开始一起养
  await M.A('global.__petMain.openTogetherWindow(), 1');
  const w0 = await until(async () => { const t = await winText('A', 'togetherWin'); return t.includes('邀请朋友一起养') ? t : null; }, 15000);
  check('一起养窗口：两个按钮（邀请朋友一起养、输入邀请码）', !!w0 && w0.includes('输入邀请码'));
  const created = await M.A(`${T}.createPet('')`);
  const code = created.code;
  const vA1 = await view('A');
  check('A 发起邀请：拿到邀请码，还没开始一起养', created.ok && vA1.alone === true && vA1.started === false && vA1.here === true, { ok: created.ok, alone: vA1.alone, started: vA1.started });
  const w1 = await until(async () => { const t = await winText('A', 'togetherWin'); return t.includes('还没开始一起养') ? t : null; }, 15000);
  check('窗口显示"还没开始一起养"、邀请码、不邀请了', !!w1 && w1.includes(code) && w1.includes('不邀请了'), w1 && w1.split('\n').slice(0, 4));
  check('托盘写"一起养…（等朋友加入）"', (await menu('A')).some(i => i.label === '一起养…（等朋友加入）'));
  check('只有自己时不写"开始一起养"日记', !(readJson('A', 'diary.json') || []).some(e => e.text === '开始和朋友一起养它'));

  // 6) B 输码申请，A 同意 → 开始一起养
  const pk = await M.B(`${T}.peek(${JSON.stringify(code)})`);
  const jb = await M.B(`${T}.joinPet(${JSON.stringify(code)}, '')`);
  check('B 输入邀请码：进等待名单', pk.ok && pk.members.length === 1 && jb.ok && jb.status === 'pending', jb);
  await M.B('global.__petMain.openTogetherWindow(), 1');
  check('B 的窗口显示"等 TA 同意"', !!(await until(async () => (await winText('B', 'togetherWin')).includes('等 TA 同意'), 15000)));
  const ask = await until(async () => { const v = await view('A'); return v.pending.length ? v : null; }, 30000);
  const askText = await until(async () => { const t = await winText('A', 'togetherWin'); return t.includes('想一起养') ? t : null; }, 15000);
  check('A 那边看到"有人想一起养"', !!ask && !!askText);
  const ap = await M.A(`${T}.approve(${JSON.stringify(ask.pending[0].id)}, true)`);
  check('A 点同意', ap.ok, ap);
  check('B 进组了', !!(await until(async () => (await view('B')).mode === 'ready', 30000)));
  const vA2 = await until(async () => { const v = await view('A'); return v.alone === false && v.started === true ? v : null; }, 20000);
  check('凑够两个人：开始一起养', !!vA2);
  check('A 的日记记下"开始和朋友一起养它"', !!(await until(() => (readJson('A', 'diary.json') || []).some(e => e.text === '开始和朋友一起养它'), 10000)));
  const w2 = await until(async () => { const t = await winText('A', 'togetherWin'); return !t.includes('还没开始') && t.includes('它在你这儿') ? t : null; }, 15000);
  check('A 的窗口换成"一起养着"（它在你这儿）', !!w2, w2 && w2.split('\n').slice(0, 3));

  // 7) 写纸条：A 写给 B，狗叼着走出 A 的屏幕、从 B 的屏幕边走进来，B 看完
  const TEXT = '测试纸条：晚上一起吃饭吗';
  const sent = await M.A(`${T}.sendNote(${JSON.stringify(TEXT)})`);
  check('A 写纸条', sent.ok, sent);
  check('A 这边：狗叼着纸条走出屏幕', !!(await until(() => page('A', 'R.dog.abroad'), 60000)));
  const arrived = await until(() => page('B', `(R.dog.carry === ${JSON.stringify(TEXT)} || (R.world.groundNote && R.world.groundNote.text === ${JSON.stringify(TEXT)}))`), 60000);
  check('B 这边：狗叼着纸条从屏幕边走进来', !!arrived);
  check('纸条算送到了（A 的待送列表空了）', !!(await until(async () => { await M.A(`${T}.refresh()`); return (await view('A')).outbox.length === 0; }, 30000, 2000)));
  const dropped = await until(() => page('B', `!!(R.world.groundNote && R.world.groundNote.noteId)`), 40000);
  check('B 这边：纸条放在鼠标旁边等着看', !!dropped);
  await page('B', '(R.openCard(), 1)'); await sleep(600); await page('B', '(R.closeCard(), 1)');
  check('B 看完，纸条收进它的纸条里', !!(await until(() => page('B', `R.dog.notes.some(n => n.text === ${JSON.stringify(TEXT)})`), 10000)));
  const vB = await view('B');
  check('狗现在在 B 这儿', vB.here === true, { here: vB.here });

  // 8) B 退出：B 回到单机的狗；A 回到"等朋友加入"
  const lb = await M.B(`${T}.leave()`);
  check('B 退出', lb.ok && lb.status === 'left', lb);
  check('B 那边回到没一起养', (await view('B')).mode === 'none');
  const back = await until(async () => { await M.A(`${T}.refresh()`); const v = await view('A'); return v.alone ? v : null; }, 30000, 1500);
  check('A 回到等朋友加入（一起养过，组不散）', !!back && back.started === true, back && { alone: back.alone, started: back.started });
  check('狗回到 A 这儿', !!(await until(async () => (await view('A')).here === true, 30000)));
  const w3 = await until(async () => { const t = await winText('A', 'togetherWin'); return t.includes('现在只剩你了') ? t : null; }, 15000);
  check('A 的窗口显示"现在只剩你了"、退出这个组', !!w3 && w3.includes('退出这个组'));

  // 8b) 只有自己时写纸条：和没一起养一样，本机演示（叼出去转一圈再叼回来），不报"还没有人和你一起养"
  const ipcCall = (k, ch, ...a) => M[k](`(async () => { const h = process.mainModule.require('electron').ipcMain._invokeHandlers.get(${JSON.stringify(ch)}); return h ? await h({}, ...${JSON.stringify(a)}) : 'no handler'; })()`);
  const ni = await ipcCall('A', 'note:info');
  const ns = await ipcCall('A', 'note:send', '只有自己时写的纸条');
  check('只有自己时写纸条：本机演示，不报错', ni && ni.mode === 'alone' && ns && ns.ok && ns.how === 'demo', { info: ni && ni.mode, send: ns });

  // 9) A 不要了：退出，组散掉
  const la = await M.A(`${T}.leave()`);
  check('A 退出：组散了', la.ok && la.status === 'gone', la);
  check('A 的窗口回到两个按钮', !!(await until(async () => (await winText('A', 'togetherWin')).includes('邀请朋友一起养'), 15000)));

  // 10) 整个过程里没有意外的错
  const bad = ['A', 'B'].flatMap(k => { let t = ''; try { t = fs.readFileSync(path.join(dirs[k], 'diag.log'), 'utf8'); } catch {} return (t.match(/"kind":"(main-error|main-rejection|frame-error|renderer-gone|renderer-unresponsive|gl-lost)"/g) || []).map(x => `${k}:${x}`); });
  check('两台的诊断记录里没有意外的错', bad.length === 0, bad);
} catch (err) {
  check('测试没跑完', false, err.message);
} finally {
  for (const p of Object.values(procs)) { try { p.kill(); } catch {} }
  await sleep(1500);
  for (const d of Object.values(dirs)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}
const ok = results.filter(r => r.pass).length;
console.log(`\n朋友视角全流程：${ok} / ${results.length} 通过`);
if (ok !== results.length) console.log(JSON.stringify(results.filter(r => !r.pass), null, 1));
process.exit(ok === results.length ? 0 : 1);
