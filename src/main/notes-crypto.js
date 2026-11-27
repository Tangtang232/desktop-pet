// 纸条加密：组里共用一把 32 字节的"组钥"，用宠物码派生出来的钥匙包好存在服务器上；
// 纸条用组钥 AES-256-GCM 加密后再上传。服务器上只有乱码，只有知道宠物码的组员解得开。
// 格式都是 "v1." 开头、点号分隔的几段 base64url，方便以后换算法时认版本。
const crypto = require('crypto');

const ITER = 200000;   // PBKDF2 轮数：在普通电脑上大约 0.1 秒，只在建组、加入、启动时算一次
const b64 = b => Buffer.from(b).toString('base64url');
const unb64 = s => Buffer.from(s, 'base64url');

function deriveKey(code, salt) {
  return crypto.pbkdf2Sync(String(code), salt, ITER, 32, 'sha256');
}
function newGroupKey() {
  return crypto.randomBytes(32);
}
function gcmSeal(key, plain, aad) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return [iv, ct, c.getAuthTag()];
}
function gcmOpen(key, iv, ct, tag, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
// 用宠物码把组钥包起来
function wrapKey(groupKey, code) {
  const salt = crypto.randomBytes(16), k = deriveKey(code, salt);
  const [iv, ct, tag] = gcmSeal(k, groupKey, 'desktop-pet:group-key');
  return ['v1', b64(salt), b64(iv), b64(ct), b64(tag)].join('.');
}
// 宠物码不对、数据坏了都返回 null
function unwrapKey(wrapped, code) {
  try {
    const [v, salt, iv, ct, tag] = String(wrapped).split('.');
    if (v !== 'v1') return null;
    const key = gcmOpen(deriveKey(code, unb64(salt)), unb64(iv), unb64(ct), unb64(tag), 'desktop-pet:group-key');
    return key.length === 32 ? key : null;
  } catch { return null; }
}
// 纸条：aad 绑定到这只宠物，别的组的纸条贴过来也解不开
function seal(groupKey, text, petId) {
  const [iv, ct, tag] = gcmSeal(groupKey, Buffer.from(String(text), 'utf8'), 'note:' + petId);
  return ['v1', b64(iv), b64(ct), b64(tag)].join('.');
}
function open(groupKey, body, petId) {
  try {
    const [v, iv, ct, tag] = String(body).split('.');
    if (v !== 'v1') return null;
    return gcmOpen(groupKey, unb64(iv), unb64(ct), unb64(tag), 'note:' + petId).toString('utf8');
  } catch { return null; }
}

module.exports = { ITER, newGroupKey, wrapKey, unwrapKey, seal, open };
