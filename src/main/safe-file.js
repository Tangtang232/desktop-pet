// 存档读写：断电、写坏、旧版本读到新版本的存档，都不能让狗"变回第一天"。
// - 写：先写临时文件、强制落盘（fsync），再改名替换。改名前把旧文件按间隔留一份 .bak
// - 读：主文件读不了就读 .bak；主文件读不了时把它改名留底（.unreadable-时间），不直接覆盖
'use strict';
const fs = require('fs');
const path = require('path');

const lastBackup = new Map();

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

// 读 JSON：{ exists, ok, value }。文件不在 exists=false；在但读不了/解析不了 ok=false
function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { return { exists: err.code !== 'ENOENT', ok: false, value: null }; }
  try { return { exists: true, ok: true, value: JSON.parse(text) }; } catch { return { exists: true, ok: false, value: null }; }
}

// 换掉旧文件之前，旧文件能读、而且离上次备份够久了，就复制成 .bak（每个文件 everyMs 内最多一次）
function backupBeforeWrite(file, everyMs, isGood = () => true) {
  const now = Date.now();
  if (now - (lastBackup.get(file) || 0) < everyMs) return;
  const cur = readJson(file);
  if (!cur.ok || !isGood(cur.value)) return;
  try { fs.copyFileSync(file, `${file}.bak`); lastBackup.set(file, now); } catch { /* 备份失败不影响存档 */ }
}

// 把读不了的文件改名留底，不删；同一个文件最多留 3 份，更早的删掉
function setAside(file) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dir = path.dirname(file), base = path.basename(file);
  try { fs.renameSync(file, path.join(dir, `${base}.unreadable-${stamp}`)); } catch { return; }
  try {
    const old = fs.readdirSync(dir).filter(n => n.startsWith(`${base}.unreadable-`)).sort();
    for (const n of old.slice(0, Math.max(0, old.length - 3))) fs.unlinkSync(path.join(dir, n));
  } catch { /* 清理留底失败无所谓 */ }
}

// 读一份要紧的存档：主文件 → .bak。validate 返回整理好的值，不认识就返回 null。
// 结果：{ value, from: 'main' | 'backup' | 'none', existed, newer, broken }
// - newer：主文件是更新版本写的（v 比自己认识的大）。这时不读备份、不留底，调用方应该只读不写，免得旧版本把新存档覆盖掉
// - broken：主文件在但读不了，已经改名留底（有备份时 from = 'backup'）
function readImportant(file, validate, knownVersion) {
  const main = readJson(file);
  if (!main.exists) return { value: null, from: 'none', existed: false, newer: false, broken: false };
  if (main.ok) {
    const v = validate(main.value);
    if (v != null) return { value: v, from: 'main', existed: true, newer: false, broken: false };
    if (knownVersion != null && main.value && typeof main.value.v === 'number' && main.value.v > knownVersion) {
      return { value: null, from: 'none', existed: true, newer: true, broken: false };
    }
  }
  const bak = readJson(`${file}.bak`);
  const bv = bak.ok ? validate(bak.value) : null;
  setAside(file);
  return { value: bv, from: bv != null ? 'backup' : 'none', existed: true, newer: false, broken: true };
}

module.exports = { writeAtomic, readJson, backupBeforeWrite, setAside, readImportant };
