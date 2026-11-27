// 合养补完的端到端测试：开四个看不见的测试副本当三个人（A、B、C），A 还有第二台电脑 A2。真连 Supabase。
// 只有一个人的组不能被人凭邀请码冒认 → 加人和审批 → 邀请码加密存一份、换码
// → 新电脑认领"我是谁"（别人同意不够，要本人点"是我"） → 狗跟着你最近在用的那台 → 请人离开的投票、两人组不能踢
// → 登录丢了凭本机的认领钥匙认回自己
// → 远程看它（小图）、远程喂 → 碗上的"它在谁那儿" → 呼唤时留它一次 → 退出、最后一个人走了组就散了（测试数据不留）
// 不动鼠标键盘，跑大约 8 分钟。用法：node tools/e2e/together-real.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const OUT = path.join(ROOT, 'tools', 'out', 'together');
fs.mkdirSync(OUT, { recursive: true });
const PORTS = { A: [9461, 9462], B: [9471, 9472], C: [9481, 9482], A2: [9491, 9492] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const results = [];
const check = (name, pass, info) => { results.push({ name, pass: !!pass, info }); log(pass ? '✔' : '✘', name, info == null ? '' : JSON.stringify(info).slice(0, 300)); };
async function until(fn, ms, every = 500) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(every); } return v; }

// ---------- 开四个测试副本 ----------
const procs = {}, dirs = {};
const launch = k => {
  const [mp, pp] = PORTS[k];
  procs[k] = spawn(ELECTRON, [`--inspect=${mp}`, '.', `--remote-debugging-port=${pp}`, `--user-data-dir=${dirs[k]}`],
    { cwd: ROOT, env: { ...process.env, PET_E2E: '1' }, stdio: 'ignore' });
};
for (const k of Object.keys(PORTS)) { dirs[k] = fs.mkdtempSync(path.join(os.tmpdir(), `pet-e2e-${k}-`)); launch(k); }
async function connect(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return async expr => {
    const i = ++id;
    const r = await new Promise(res => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true, timeout: 60000 } })); });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result ? r.result.value : r;
  };
}
async function target(port, pick) {
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const t = pick ? l.find(pick) : l[0]; if (t) return t.webSocketDebuggerUrl; } catch {}
    await sleep(500);
  }
  throw new Error('连不上 ' + port);
}
const M = {}, P = {};
const T = 'global.__petMain.together';
const view = k => M[k](`${T}.view(true)`);
const dbg = k => M[k](`${T}._debug()`);
const page = (k, e) => P[k](`(() => { const R = window.__rig; return ${e}; })()`);
const idle = (k, sec) => M[k](`(() => { const pm = process.mainModule.require('electron').powerMonitor; pm.__orig = pm.__orig || pm.getSystemIdleTime; pm.getSystemIdleTime = ${sec == null ? 'pm.__orig' : `() => ${sec}`}; return 1; })()`);
const shot = async (k, win, name) => {
  const b64 = await M[k](`(async () => { const w = global.__petMain.${win}; if (!w) return null; await new Promise(r => setTimeout(r, 600)); return (await w.webContents.capturePage()).toPNG().toString('base64'); })()`);
  if (b64) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64'));
};

try {
  for (const k of Object.keys(PORTS)) {
    M[k] = await connect(await target(PORTS[k][0]));
    P[k] = await connect(await target(PORTS[k][1], t => t.type === 'page' && /index\.html/.test(t.url)));
  }
  const ready = await until(async () => { const vs = await Promise.all(Object.keys(PORTS).map(view)); return vs.every(v => v.mode === 'none') && vs; }, 40000);
  check('四台都连上服务器（匿名登录）', !!ready, ready && ready.map(v => v.mode));
  if (!ready) throw new Error('连不上服务器');

  // 1) A 建组；B、C 输码加入，等审批
  const created = await M.A(`${T}.createPet('')`);
  check('A 建组拿到邀请码', created.ok, { ok: created.ok, error: created.error });
  let code = created.code;
  const createdAt = Date.now();
  // 两个人才算一起养：只有 A 时只是发出了邀请
  const vA0 = await view('A');
  check('A 发出邀请：还没开始一起养（等朋友加入）', vA0.alone === true && vA0.started === false, { alone: vA0.alone, started: vA0.started });
  // 1a) 组里只有 A 一个人时，拿到邀请码的人想冒认 A：A 的电脑最近还在，所以得 A 点"是我"，不能凭邀请码直接生效
  const aMe0 = (await dbg('A')).me;
  const pkS = await M.C(`${T}.peek(${JSON.stringify(code)})`);
  const fake = await M.C(`${T}.claim(${JSON.stringify(code)}, ${JSON.stringify(aMe0)})`);
  check('只有一个人的组：别人拿邀请码冒认 A，不能直接生效', pkS.ok && fake.ok && fake.status === 'pending', fake);
  const seen = await until(async () => { const v = await view('A'); return v.claims.length ? v : null; }, 30000);
  check('A 那边看到"有台新电脑说它是你"', !!seen && seen.claims[0].mine === true, seen && seen.claims);
  const no = seen ? await M.A(`${T}.approveDevice(${JSON.stringify(seen.claims[0].user)}, ${JSON.stringify(seen.claims[0].member)}, false)`) : {};
  check('A 点"不是"：冒认作废', no.ok && no.status === 'rejected', no);
  check('冒认的那台回到没进组', !!(await until(async () => { await M.C(`${T}.refresh()`); return (await view('C')).mode === 'none'; }, 30000, 2000)));
  const pkB = await M.B(`${T}.peek(${JSON.stringify(code)})`);
  check('B 输码先看到组里有一个人', pkB.ok && pkB.members.length === 1, pkB);
  const jB = await M.B(`${T}.joinPet(${JSON.stringify(code)}, '')`);
  check('B 第一次来，进等待名单', jB.ok && jB.status === 'pending', jB);
  const pA = await until(async () => { const v = await view('A'); return v.pending.length ? v : null; }, 30000);
  await M.A(`${T}.approve(${JSON.stringify(pA.pending[0].id)}, true)`);
  check('A 同意后 B 进组', !!(await until(async () => (await view('B')).mode === 'ready', 20000)));
  const started = await until(async () => { await M.A(`${T}.refresh()`); const v = await view('A'); return v.alone === false && v.started === true ? v : null; }, 20000, 1000);
  check('凑够两个人：开始一起养了', !!started);
  const sAt = await M.A(`${T}._pet() && ${T}._pet().started_at`);
  check('服务器记下了开始一起养的时间', !!sAt, sAt);
  const vB0 = await view('B');
  check('B 那边看到的邀请码就是 A 的码（服务器上加密存了一份）', vB0.code === code, { same: vB0.code === code });
  const jC = await M.C(`${T}.joinPet(${JSON.stringify(code)}, '')`);
  check('C 进等待名单', jC.ok && jC.status === 'pending', jC);
  const pA2 = await until(async () => { const v = await view('A'); return v.pending.length ? v : null; }, 30000);
  const cId = pA2.pending[0].id;
  const a1 = await M.A(`${T}.approve(${JSON.stringify(cId)}, true)`);
  check('三个人时只有 A 同意还不够', a1.ok && a1.status === 'pending', a1);
  await until(async () => (await view('B')).pending.length > 0, 30000);
  const b1 = await M.B(`${T}.approve(${JSON.stringify(cId)}, true)`);
  check('B 也同意，C 进组', b1.ok && b1.status === 'active', b1);
  await until(async () => (await view('C')).mode === 'ready', 20000);

  // 2) 换邀请码：B 换，A 那边跟着变；旧码进不来
  const oldCode = code;
  const rot = await M.B(`${T}.rotateCode()`);
  check('B 换了邀请码', rot.ok && rot.code !== oldCode, { ok: rot.ok, error: rot.error });
  code = rot.code;
  const aCode = await until(async () => { await M.A(`${T}.refresh()`); const v = await view('A'); return v.code === code ? v.code : null; }, 30000, 2000);
  check('A 那边的邀请码也变成新的', !!aCode);
  const pkOld = await M.A2(`${T}.peek(${JSON.stringify(oldCode)})`);
  check('旧邀请码作废了', !pkOld.ok && /不对/.test(pkOld.error || ''), pkOld);

  // 3) A 的第二台电脑 A2：输码、认自己，A 点"是我"
  const aMe = (await dbg('A')).me;
  const pk = await M.A2(`${T}.peek(${JSON.stringify(code)})`);
  check('A2 用新码看到组里三个人', pk.ok && pk.members.length === 3, pk.ok ? pk.members.length : pk);
  const cl = await M.A2(`${T}.claim(${JSON.stringify(code)}, ${JSON.stringify(aMe)})`);
  check('A2 说"我是 A"，等确认', cl.ok && cl.status === 'pending', cl);
  check('A2 的窗口显示在等确认', (await view('A2')).pendingKind === 'claim');
  const claimA = await until(async () => { const v = await view('A'); return v.claims.length ? v : null; }, 30000);
  check('A 那边看到"有台新电脑说它是你"', !!claimA && claimA.claims[0].mine === true, claimA && claimA.claims);
  await M.A('global.__petMain.openTogetherWindow(), 1'); await shot('A', 'togetherWin', 'claim-on-A');
  const cB = await view('B');
  check('B 那边也看到"有台新电脑说自己是 TA"（B 也能确认）', cB.claims.length === 1 && cB.claims[0].mine === false, cB.claims);
  // 别人点同意不够：要组里除了 A 以外的人都同意（B 和 C），或者 A 本人点"是我"
  const bOk = await M.B(`${T}.approveDevice(${JSON.stringify(cB.claims[0].user)}, ${JSON.stringify(cB.claims[0].member)}, true)`);
  check('B 点同意还不够（还要 C，或者 A 本人点"是我"）', bOk.ok && bOk.status === 'pending', bOk);
  const vBv = await view('B');
  check('B 那边显示"你同意了，等其他人"', vBv.claims.some(c => c.voted), vBv.claims);
  check('A2 还在等', (await view('A2')).mode === 'pending');
  const ap = await M.A(`${T}.approveDevice(${JSON.stringify(claimA.claims[0].user)}, ${JSON.stringify(claimA.claims[0].member)}, true)`);
  check('A 点"是我"', ap.ok && ap.status === 'active', ap);
  const vA2 = await until(async () => { const v = await view('A2'); return v.mode === 'ready' ? v : null; }, 30000);
  check('A2 进来了，身份就是 A', !!vA2 && (await dbg('A2')).me === aMe);
  check('A2：狗在你另一台电脑上（不会出现两只）', !!vA2 && vA2.onMyOther === true && vA2.here === false, vA2 && { here: vA2.here, onMyOther: vA2.onMyOther });
  // 狗站着时是先走出屏幕边再消失：从 2048 宽屏幕的正中间走出去约 16 秒，给 40 秒
  check('A2 的桌面上没有狗', !!(await until(() => page('A2', 'R.dog.abroad'), 40000)));

  // 4) 狗跟着最近在用的那台：A 那台没人用了（假装键鼠 400 秒没动），A2 叫它过来
  //    B、C 也假装不在，免得 A 那台"主人走开了"时把狗送去别人那儿
  for (const k of ['A', 'B', 'C']) { await idle(k, 400); await M[k](`${T}._beat()`); }
  await idle('A2', 5); await M.A2(`${T}._beat()`);   // 你正在 A2 上用着：A 那台没人用，也不算你走开了
  const busy = await M.A2(`${T}.callPet()`);
  check('A 那台刚刚还有人用：A2 叫不过来', !busy.ok && /有人在用/.test(busy.error || ''), busy);
  const waitFrom = Date.now();

  // 等 A 那台"没人用"满 90 秒的空当里：请 C 离开
  const kv = await view('A');
  check('三个人以上能提议请人离开', kv.canKick === true);
  const k1 = await M.A(`${T}.voteKick(${JSON.stringify(cId)}, true)`);
  check('A 提议请 C 离开：还要等 B', k1.ok && k1.status === 'voting', k1);
  const kB = await until(async () => { await M.B(`${T}.refresh()`); const v = await view('B'); return v.kicks.length ? v : null; }, 30000, 2000);
  check('B 看到投票（1/2）', !!kB && kB.kicks[0].yes === 1 && kB.kicks[0].need === 2, kB && kB.kicks);
  await M.B('global.__petMain.openTogetherWindow(), 1'); await shot('B', 'togetherWin', 'kick-vote-on-B');
  const kC = await view('C');
  check('C 自己看不到投票', kC.kicks.length === 0, kC.kicks);
  const codeBefore = code;
  const k2 = await M.B(`${T}.voteKick(${JSON.stringify(cId)}, true)`);
  check('B 也同意：C 被请离开', k2.ok && k2.status === 'kicked', k2);
  const cGone = await until(async () => { await M.C(`${T}.refresh()`); return (await view('C')).mode === 'none'; }, 40000, 2000);
  check('C 那边：不在组里了', !!cGone);
  const vB2 = await view('B');
  check('请走以后邀请码自动换了', vB2.code && vB2.code !== codeBefore, { changed: vB2.code !== codeBefore });
  code = vB2.code;
  const pkC = await M.C(`${T}.peek(${JSON.stringify(codeBefore)})`);
  check('C 拿旧码进不来', !pkC.ok, pkC);
  const two = await M.A(`${T}.voteKick(${JSON.stringify((await dbg('B')).me)}, true)`);
  check('剩两个人时不能请人离开', !two.ok && /两个人/.test(two.error || ''), two);

  await sleep(Math.max(0, 95000 - (Date.now() - waitFrom)));
  const fol = await M.A2(`${T}.callPet()`);
  check('A 那台闲了 90 秒：A2 叫它过来', fol.ok, fol);
  const vA2b = await until(async () => { const v = await view('A2'); return v.here ? v : null; }, 20000);
  check('狗到了 A2 这台', !!vA2b);
  check('A2 页面：狗从屏幕边走进来', !!(await until(async () => (await page('A2', 'R.dog.abroad')) === false, 15000)));
  check('A 页面：狗走了', !!(await until(() => page('A', 'R.dog.abroad'), 15000)));
  const vA3 = await view('A');
  check('A 那边：狗在你另一台电脑上', vA3.onMyOther === true, { onMyOther: vA3.onMyOther });
  for (const k of ['A', 'B']) { await idle(k, null); await M[k](`${T}._beat()`); }
  await idle('A2', 5); await M.A2(`${T}._beat()`);

  // 5) 远程看它、远程喂：B 打开"看看它"
  await M.B('global.__petMain.openWatchWindow(), 1');
  const snap = await until(() => M.B(`${T}.latestSnapshot()`), 30000, 1500);
  check('B 收到 A2 传来的狗的小图', !!snap && snap.img.startsWith('data:image/png;base64,') && snap.img.length > 1500, snap && { len: snap.img.length, doing: snap.doing });
  if (snap) fs.writeFileSync(path.join(OUT, 'snapshot.png'), Buffer.from(snap.img.split(',')[1], 'base64'));
  const shown = await until(() => M.B(`global.__petMain.watchWin && global.__petMain.watchWin.webContents.executeJavaScript("!!document.querySelector('#view img')")`), 15000, 1000);
  check('"看看它"窗口里显示出图', !!shown);
  await shot('B', 'watchWin', 'watch-on-B');
  const fed = await M.B(`${T}.remoteFeed()`);
  check('B 远程喂一碗', fed.ok, fed);
  const bowlFull = await until(async () => { const r = await page('A2', '({ food: R.world.food, bubble: document.getElementById("bubble").hidden ? "" : document.getElementById("bubbleText").textContent })'); return r.food === 1 && r.bubble ? r : null; }, 20000);
  check('A2 那边碗满了，碗上说是谁喂的', !!bowlFull && /隔空喂了一碗/.test(bowlFull.bubble), bowlFull);
  const fed2 = await M.B(`${T}.remoteFeed()`);
  check('刚喂过，再喂要等一会儿', !fed2.ok && /刚有人喂过/.test(fed2.error || ''), fed2);
  await M.B('global.__petMain.watchWin && global.__petMain.watchWin.close(), 1');

  // 6) B 桌面上点碗：气泡说它在 TA 那儿，能看看它、叫它回来
  const bub = await P.B(`(() => { window.__rig.showAwayBubble(); return { text: document.getElementById('bubbleText').textContent, btns: [...document.querySelectorAll('#bubbleBtns button')].map(b => b.textContent) }; })()`);
  check('B 点碗：气泡说它在 TA 那儿', /它在 TA 那儿/.test(bub.text) && bub.btns.includes('看看它') && bub.btns.includes('叫它回来'), bub);
  const bubA = await P.A(`(() => { window.__rig.showAwayBubble(); return { text: document.getElementById('bubbleText').textContent, btns: [...document.querySelectorAll('#bubbleBtns button')].map(b => b.textContent) }; })()`);
  check('A 点碗：它在你另一台电脑上，按钮是"叫它过来"', /另一台电脑/.test(bubA.text) && bubA.btns.includes('叫它过来'), bubA);

  // 6b) B 的登录丢了（服务器作废了凭据、后台清了匿名用户）：重启后换了个新身份。
  //     凭本机的认领钥匙自己认回来，不用别人确认，也不会把组忘掉
  const bBefore = await dbg('B');
  procs.B.kill(); await new Promise(r => procs.B.once('exit', r)); await sleep(1000);
  const vf = path.join(dirs.B, 'together.json'), vb = JSON.parse(fs.readFileSync(vf, 'utf8'));
  for (const k of Object.keys(vb)) if (k.startsWith('auth:')) delete vb[k];
  fs.writeFileSync(vf, JSON.stringify(vb, null, 1));
  launch('B');
  M.B = await connect(await target(PORTS.B[0]));
  P.B = await connect(await target(PORTS.B[1], t => t.type === 'page' && /index\.html/.test(t.url)));
  const vBr = await until(async () => { const v = await view('B'); return v.mode === 'ready' ? v : null; }, 60000, 1000);
  const bAfter = await dbg('B');
  check('B 的登录丢了：重启后自己认回来（同一个成员、新的身份，不用别人确认）', !!vBr && bAfter.me === bBefore.me && bAfter.uid !== bBefore.uid, { mode: vBr && vBr.mode, sameMember: bAfter.me === bBefore.me, newUid: bAfter.uid !== bBefore.uid });

  // 7) 呼唤时留它一次：A2 正在和它玩（刚摸过），B 叫它；等过了"刚到 5 分钟"的保护期
  await sleep(Math.max(0, createdAt + 5 * 60 * 1000 + 5000 - Date.now()));
  await M.A2(`${T}.heartEvent('pet')`);
  await idle('B', 5); await M.B(`${T}._beat()`);   // B 在电脑前（不受跑测试时你真实的键鼠空闲影响）
  const called = await M.B(`${T}.callPet()`);
  check('B 呼唤它', called.ok && called.status === 'called', called);
  const ask = await until(async () => { const r = await P.A2(`({ hidden: document.getElementById('bubble').hidden, text: document.getElementById('bubbleText').textContent })`); return !r.hidden && /在叫它回去/.test(r.text) ? r : null; }, 20000);
  check('A2 正在玩：狗身上冒气泡问"让它去 / 再玩一会儿"', !!ask, ask);
  await P.A2(`(() => { const b = [...document.querySelectorAll('#bubbleBtns button')].find(x => x.textContent === '再玩一会儿'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return 1; })()`);
  const kept = await until(async () => { await M.B(`${T}.refresh()`); const v = await view('B'); return v.kept ? v : null; }, 20000, 1500);
  check('点"再玩一会儿"：B 那边看到"TA 想再和它玩一会儿"', !!kept);
  await sleep(4000);
  check('留住了：狗还在 A2 这儿', (await view('A2')).here === true);

  // 8) 退出：B 退出，回到单机的狗；A（两台电脑）退出，最后一个人走了组就散了
  const lb = await M.B(`${T}.leave()`);
  check('B 退出', lb.ok && lb.status === 'left', lb);
  check('B 那边回到单机', (await view('B')).mode === 'none');
  check('B 的桌面上狗回来了（单机的那只）', !!(await until(async () => (await page('B', 'R.dog.abroad')) === false, 15000)));
  const back = await until(async () => { await M.A2(`${T}.refresh()`); const v = await view('A2'); return v.alone ? v : null; }, 20000, 1000);
  check('只剩 A 了：回到等朋友加入（组不散，算一起养过）', !!back && back.started === true, back && { alone: back.alone, started: back.started });
  const la = await M.A2(`${T}.leave()`);
  check('A 也退出：组散了（服务器上这个组的数据都删了）', la.ok && la.status === 'gone', la);
  check('A 的另一台电脑也跟着不在组里了', !!(await until(async () => { await M.A(`${T}.refresh()`); return (await view('A')).mode === 'none'; }, 40000, 2000)));

  // 9) 本机保险箱：机密的用异步系统加密（a:），"狗在不在这儿"这类不加密（p:），没有老格式（e:）
  await sleep(1000);
  const vault = JSON.parse(fs.readFileSync(path.join(dirs.A2, 'together.json'), 'utf8'));
  const kinds = [...new Set(Object.values(vault).map(v => String(v).slice(0, 2)))];
  check('本机保险箱只有 a:（加密）和 p:（不机密）两种', kinds.every(k => k === 'a:' || k === 'p:') && kinds.includes('a:'), kinds);
} catch (err) {
  check('测试没跑完', false, err.message);
} finally {
  for (const p of Object.values(procs)) { try { p.kill(); } catch {} }
  await sleep(1500);
  for (const d of Object.values(dirs)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  const passed = results.filter(r => r.pass).length;
  console.log(`\n合养补完端到端：${passed} / ${results.length} 通过（截图在 tools/out/together）`);
  const bad = results.filter(r => !r.pass);
  if (bad.length) console.log(JSON.stringify(bad, null, 1));
  process.exit(bad.length ? 1 : 0);
}
