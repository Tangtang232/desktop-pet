// 存档保护的真实测试：开一个看不见的测试副本（不联网、不动鼠标、不碰正在养的那只），看三件事：
// 1. 开机慢、页面还没读到存档就被重载（看门狗、崩溃）：存档不能被一只默认小狗盖掉
// 2. 存档是更新版本写的：旧版本只读不写，原样留着
// 3. 存档写坏了：用 .bak 接着养，坏的那份改名留底
// 用法：node tools/e2e/save-real.mjs        （约 1 分钟）
// 想看旧版本是不是真有这个问题：PET_ROOT=<旧版本的目录> node tools/e2e/save-real.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = process.env.PET_ROOT ? path.resolve(process.env.PET_ROOT) : HERE;
const ELECTRON = path.join(HERE, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const [MP, PP] = [9541, 9542];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const results = [];
const check = (name, pass, info) => { results.push({ name, pass: !!pass }); log(pass ? '✔' : '✘', name, info == null ? '' : JSON.stringify(info).slice(0, 200)); };
async function until(fn, ms, every = 200) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await sleep(every); } return v; }

async function connect(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const ev = async expr => {
    const i = ++id;
    const r = await new Promise(res => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true } })); });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    if (!r.result) throw new Error(JSON.stringify(r).slice(0, 200));   // 页面正在重载时会回一个错误
    return r.result.value;
  };
  ev.close = () => ws.close();
  return ev;
}
async function target(port, pick) {
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const t = pick ? l.find(pick) : l[0]; if (t) return t.webSocketDebuggerUrl; } catch {}
    await sleep(100);
  }
  throw new Error('连不上 ' + port);
}

// 不联网：给一个不能用的联网配置
const offline = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pet-save-cfg-')), 'offline.json');
fs.writeFileSync(offline, JSON.stringify({ url: 'offline', publishableKey: 'offline' }));
let proc = null;
function launch(ud) {
  proc = spawn(ELECTRON, [`--inspect=${MP}`, '.', `--remote-debugging-port=${PP}`, `--user-data-dir=${ud}`],
    { cwd: ROOT, env: { ...process.env, PET_E2E: '1', PET_SUPABASE_CONFIG: offline }, stdio: 'ignore' });
}
async function stop() { if (proc) { proc.kill(); await new Promise(r => proc.once('exit', r)); proc = null; await sleep(500); } }
const state = extra => ({ v: 1, savedAt: Date.now(), x: 0.4, facing: 1, belly: 0.77, food: 0.2, notes: [{ text: '测试纸条，不要丢', at: Date.now() - 60000, unread: false }], ...extra });
const readState = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

try {
  // ---------- 1. 页面还没读到存档就被重载 ----------
  {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-save-1-')), f = path.join(ud, 'pet-state.json');
    fs.writeFileSync(f, JSON.stringify(state()));
    launch(ud);
    const M = await connect(await target(MP));
    const P = await connect(await target(PP, t => t.type === 'page' && /index\.html/.test(t.url)));
    // 等页面脚本跑起来了（定时存档、关页面时存档都挂上了）、但素材还在解码、存档还没读进来的那一刻，重载它：
    // 这时页面手里是一只默认小狗。连着来两次
    let reloads = 0;
    for (let i = 0; i < 2; i++) {
      const hit = await until(() => P(`document.readyState !== 'loading' && !window.__rig`), 15000, 5);
      if (!hit) break;
      await M(`global.__petMain.win.webContents.reload(), 1`);
      reloads++;
      await sleep(300);
    }
    check('页面脚本跑起来、还没读到存档时被重载了两次', reloads === 2);
    const notes = await until(() => P(`window.__rig && window.__rig.dog.notes.map(n => n.text)`), 20000);
    check('页面读到的还是原来的狗（纸条还在）', notes && notes.includes('测试纸条，不要丢'), notes);
    await sleep(17000);   // 过一次定时存档
    const s = readState(f);
    check('存档里的纸条还在（没被默认小狗盖掉）', s && s.notes.some(n => n.text === '测试纸条，不要丢'), s && s.notes);
    let diary = []; try { diary = JSON.parse(fs.readFileSync(path.join(ud, 'diary.json'), 'utf8')); } catch {}
    check('日记里没有"第一天来到这里"', !diary.some(e => e.text === '第一天来到这里'), diary.map(e => e.text));
    M.close(); P.close(); await stop();
  }

  // ---------- 2. 存档是更新版本写的 ----------
  {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-save-2-')), f = path.join(ud, 'pet-state.json');
    const newer = { ...state(), v: 2, fromTheFuture: true };
    fs.writeFileSync(f, JSON.stringify(newer));
    launch(ud);
    const P = await connect(await target(PP, t => t.type === 'page' && /index\.html/.test(t.url)));
    await until(() => P(`!!window.__rig`), 20000);
    await sleep(17000);
    const s = readState(f);
    check('新版本的存档原样留着（旧版本没覆盖）', s && s.v === 2 && s.fromTheFuture === true, s && { v: s.v });
    P.close(); await stop();
  }

  // ---------- 3. 存档写坏了，有备份 ----------
  {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-save-3-')), f = path.join(ud, 'pet-state.json');
    fs.writeFileSync(f, '{"v":1,"savedAt":17');   // 断电写了一半
    fs.writeFileSync(`${f}.bak`, JSON.stringify(state({ belly: 0.33, notes: [{ text: '备份里的纸条', at: Date.now() - 60000, unread: false }] })));
    launch(ud);
    const P = await connect(await target(PP, t => t.type === 'page' && /index\.html/.test(t.url)));
    const notes = await until(() => P(`window.__rig && window.__rig.dog.notes.map(n => n.text)`), 20000);
    check('用备份接着养', notes && notes.includes('备份里的纸条'), notes);
    check('坏的那份改名留底了', fs.readdirSync(ud).some(n => n.startsWith('pet-state.json.unreadable-')));
    P.close(); await stop();
  }
} catch (err) {
  log('出错:', err.message);
  results.push({ name: '跑完', pass: false });
} finally {
  await stop();
}
const ok = results.filter(r => r.pass).length;
console.log(`\n存档保护：${ok} / ${results.length} 通过`);
process.exit(ok === results.length ? 0 : 1);
