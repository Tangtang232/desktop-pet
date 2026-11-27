// 本机保险箱（together.json）：值没变就不重写文件；写盘排队，最后的值落盘；老版本同步加密的数据能读出来并换成异步加密
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _makeVault } = require('../src/main/together.js');

function tmp() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-vault-')); return { dir, file: path.join(dir, 'together.json') }; }

test('保险箱：同样的值再存一次不写盘，变了才写', async () => {
  const { dir, file } = tmp();
  const real = fs.writeFileSync;
  let writes = 0;
  fs.writeFileSync = (...a) => { writes++; return real.apply(fs, a); };
  try {
    const v = _makeVault(file, null);
    await v.ready;
    await v.set('lastHere', '1'); assert.equal(writes, 1);
    await v.set('lastHere', '1'); assert.equal(writes, 1);
    await v.set('lastHere', 1); assert.equal(writes, 1, '数字和字符串一样也不重写');
    await v.set('lastHere', '0'); assert.equal(writes, 2);
    await v.set('gone', null); assert.equal(writes, 2, '删一个本来就没有的键不写');
    await v.set('lastHere', null); assert.equal(writes, 3);
    assert.equal(v.get('lastHere'), null);
    v.set('code', 'A'); v.set('code', 'B'); v.set('code', 'ABCD');
    await v.flush();
    const again = _makeVault(file, null); await again.ready;
    assert.equal(again.get('code'), 'ABCD', '连着写几次，文件里留下最后一次');
  } finally {
    fs.writeFileSync = real;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 假的系统加密：同步、异步两套，格式不同，异步接口解不开同步接口加密的东西（最坏情况）
const fake = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async s => Buffer.from('A|' + s),
  decryptStringAsync: async b => { const s = b.toString(); if (!s.startsWith('A|')) throw new Error('bad'); return { result: s.slice(2), shouldReEncrypt: false }; },
  decryptString: b => { const s = b.toString(); if (!s.startsWith('S|')) throw new Error('bad'); return s.slice(2); }
};

test('保险箱：老版本同步加密的能读出来，并换成异步加密；不机密的几项改成不加密', async () => {
  const { dir, file } = tmp();
  try {
    const enc = s => 'e:' + Buffer.from('S|' + s).toString('base64');
    fs.writeFileSync(file, JSON.stringify({ groupKey: enc('k123'), lastHere: enc('0'), petId: enc('p1') }));
    const v = _makeVault(file, fake);
    assert.equal(v.get('groupKey'), null, '机密的要等解开以后才读得到');
    await v.ready;
    assert.equal(v.get('groupKey'), 'k123');
    assert.equal(v.get('petId'), 'p1');
    assert.equal(v.get('lastHere'), '0');
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(disk.groupKey.startsWith('a:'), '换成异步加密');
    assert.ok(disk.lastHere.startsWith('p:'), '"狗在不在这儿"不机密，改成不加密');
    const again = _makeVault(file, fake);
    assert.equal(again.get('lastHere'), '0', '不加密的一启动就能读');
    await again.ready;
    assert.equal(again.get('groupKey'), 'k123', '重开后照样读得出来');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
