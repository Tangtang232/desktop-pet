const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SF = require('../src/main/safe-file.js');
const L = require('../src/renderer/logic.js');
const V = require('../src/shared/visit.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pet-savefile-'));
const good = { v: 1, savedAt: Date.now(), x: 0.4, facing: 1, belly: 0.6, food: 0.2, notes: [] };

test('写存档：强制落盘再替换，不留临时文件', () => {
  const dir = tmp(), f = path.join(dir, 'pet-state.json');
  SF.writeAtomic(f, JSON.stringify(good));
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), good);
  assert.equal(fs.existsSync(`${f}.tmp`), false);
});

test('换掉旧存档前按间隔留一份 .bak；读不了的旧存档不当备份', () => {
  const dir = tmp(), f = path.join(dir, 'pet-state.json');
  SF.writeAtomic(f, JSON.stringify(good));
  SF.backupBeforeWrite(f, 3600e3);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${f}.bak`, 'utf8')), good);
  // 一小时内不再备份：.bak 还是第一份
  SF.writeAtomic(f, JSON.stringify({ ...good, belly: 0.1 }));
  SF.backupBeforeWrite(f, 3600e3);
  assert.equal(JSON.parse(fs.readFileSync(`${f}.bak`, 'utf8')).belly, 0.6);
  // 坏文件不拿来当备份
  const g = path.join(dir, 'diary.json');
  fs.writeFileSync(g, '{坏了');
  SF.backupBeforeWrite(g, 0);
  assert.equal(fs.existsSync(`${g}.bak`), false);
});

test('读存档：好的直接读；坏了用备份，坏的那份改名留底', () => {
  const dir = tmp(), f = path.join(dir, 'pet-state.json');
  assert.deepEqual(SF.readImportant(f, L.sanitizeState, 1), { value: null, from: 'none', existed: false, newer: false, broken: false });
  SF.writeAtomic(f, JSON.stringify(good));
  assert.equal(SF.readImportant(f, L.sanitizeState, 1).from, 'main');
  fs.writeFileSync(`${f}.bak`, JSON.stringify({ ...good, belly: 0.9 }));
  fs.writeFileSync(f, '{"v":1,"savedAt":');   // 断电写了一半
  const r = SF.readImportant(f, L.sanitizeState, 1);
  assert.equal(r.from, 'backup'); assert.equal(r.broken, true); assert.equal(r.value.belly, 0.9);
  assert.equal(fs.existsSync(f), false, '坏的主文件挪走了');
  assert.equal(fs.readdirSync(dir).filter(n => n.startsWith('pet-state.json.unreadable-')).length, 1);
});

test('读存档：没有备份也坏了 → 重新开始，但坏的留着', () => {
  const dir = tmp(), f = path.join(dir, 'pet-state.json');
  fs.writeFileSync(f, 'not json');
  const r = SF.readImportant(f, L.sanitizeState, 1);
  assert.equal(r.value, null); assert.equal(r.broken, true); assert.equal(r.from, 'none');
  assert.equal(fs.readdirSync(dir).filter(n => n.includes('unreadable')).length, 1);
});

test('读存档：更新版本写的（v 更大）→ 不碰它、不用备份，调用方只读不写', () => {
  const dir = tmp(), f = path.join(dir, 'pet-state.json');
  fs.writeFileSync(f, JSON.stringify({ ...good, v: 2, something: 'new' }));
  fs.writeFileSync(`${f}.bak`, JSON.stringify(good));
  const r = SF.readImportant(f, L.sanitizeState, 1);
  assert.equal(r.newer, true); assert.equal(r.value, null); assert.equal(r.broken, false);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).v, 2, '新存档原样留着');
});

test('留底最多 3 份', () => {
  const dir = tmp(), f = path.join(dir, 'x.json');
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(f, 'bad');
    fs.writeFileSync(path.join(dir, `x.json.unreadable-2026010100000${i}`), 'old');
  }
  SF.setAside(f);
  assert.equal(fs.readdirSync(dir).filter(n => n.startsWith('x.json.unreadable-')).length, 3);
});

test('名字：去掉看不见的零宽、左右反转字符，看着一样的名字就是同一个名字', () => {
  assert.equal(V.cleanNickname('小​明'), '小明');
  assert.equal(V.cleanNickname('‮小明'), '小明');
  assert.equal(V.cleanNickname('小明﻿'), '小明');
  assert.equal(V.cleanNickname('@小明'), '小明');
  assert.equal(V.cleanNickname('一二三四五六七八九十十一十二'), '一二三四五六七八九十十一');
});
