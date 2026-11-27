const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const V = require('../src/shared/visit.js');
const C = require('../src/main/notes-crypto.js');

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MIN = 60000, HOUR = 60 * MIN, NOW = 1_800_000_000_000;
const mem = (id, o = {}) => ({ id, status: 'active', nickname: id, heart: 0.3, lastWith: NOW - HOUR, activeAt: NOW - 10000, ...o });
// 狗在 a 那儿，每分钟问一次，最多问 limit 分钟，返回第一次决定走的结果和第几分钟
function runUntilLeave(base, limit = 600, seed = 1) {
  const r = seeded(seed);
  for (let i = 1; i <= limit; i++) {
    const d = V.decide({ ...base, now: base.now + i * MIN, dtMs: MIN }, r);
    if (d) return { ...d, minute: i };
  }
  return null;
}

test('串门：另一个人不在电脑前，狗哪儿也不去', () => {
  const s = { now: NOW, me: 'a', hostSince: NOW - 5 * HOUR, members: [mem('a'), mem('b', { activeAt: NOW - 10 * MIN })], notes: [] };
  assert.equal(runUntilLeave({ ...s, members: [mem('a'), mem('b', { activeAt: null })] }), null);
  assert.equal(V.decide(s, () => 0), null);
});

test('串门：刚到不满 10 分钟不走；两边差不多时平均二十来分钟串一次门', () => {
  const base = { now: NOW, me: 'a', hostSince: NOW, members: [mem('a'), mem('b')], notes: [] };
  // 每次都让对方一直在线
  const live = o => ({ ...o, members: [mem('a'), mem('b', { activeAt: Infinity })] });
  let total = 0, n = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const r = seeded(seed);
    for (let i = 1; i <= 600; i++) {
      const now = NOW + i * MIN, d = V.decide({ ...live(base), now, dtMs: MIN, members: [mem('a'), mem('b', { activeAt: now })] }, r);
      if (d) { assert.ok(i >= 10, `第 ${i} 分钟就走了`); total += i; n++; break; }
    }
  }
  const avg = total / n;
  assert.ok(avg > 18 && avg < 45, `平均 ${avg.toFixed(1)} 分钟`);
});

test('心动值：这边心动值高，它待得更久；对方想它想得厉害，它走得更早', () => {
  const avgStay = (meHeart, other) => {
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = seeded(seed);
      for (let i = 1; i <= 2000; i++) {
        const now = NOW + i * MIN;
        const d = V.decide({ now, me: 'a', hostSince: NOW, dtMs: MIN, notes: [], members: [mem('a', { heart: meHeart }), mem('b', { ...other, activeAt: now })] }, r);
        if (d) { total += i; break; }
      }
    }
    return total / 200;
  };
  const even = avgStay(0.3, { heart: 0.3, lastWith: NOW });
  const loved = avgStay(1, { heart: 0.3, lastWith: NOW });
  const missed = avgStay(0.3, { heart: 0.3, lastWith: NOW - 8 * HOUR });
  assert.ok(loved > even * 1.6, `心动值高 ${loved.toFixed(0)} vs ${even.toFixed(0)}`);
  assert.ok(missed < even * 0.75, `被想念 ${missed.toFixed(0)} vs ${even.toFixed(0)}`);
});

test('纸条：收件人在电脑前，马上叼着去；不在就等着', () => {
  const note = { id: 'n1', from: 'a', to: 'b', createdAt: NOW - 1000, deliveredAt: null };
  const s = { now: NOW, me: 'a', hostSince: NOW, dtMs: MIN, notes: [note], members: [mem('a'), mem('b')] };
  assert.deepEqual(V.decide(s, () => 0.99), { to: 'b', reason: 'note', noteId: 'n1' });
  assert.equal(V.decide({ ...s, members: [mem('a'), mem('b', { activeAt: NOW - 10 * MIN })] }, () => 0), null);
  // 送过的不再送
  assert.equal(V.decide({ ...s, notes: [{ ...note, deliveredAt: NOW }] }, () => 0.99), null);
});

test('纸条：狗在收件人那儿，写纸条的人在线，它会先回去拿（比平时快）', () => {
  const note = { id: 'n1', from: 'b', to: 'a', createdAt: NOW, deliveredAt: null };
  const s = { now: NOW, me: 'a', hostSince: NOW - MIN, notes: [note], members: [mem('a'), mem('b')] };
  assert.equal(V.decide({ ...s, dtMs: MIN }, () => 0), null, '刚到 1 分钟不走');
  const d = runUntilLeave({ ...s, members: [mem('a'), mem('b', { activeAt: Infinity })] });
  assert.equal(d.reason, 'fetch'); assert.equal(d.to, 'b');
  assert.ok(d.minute <= 10, `第 ${d.minute} 分钟才走`);
});

test('主人走开了：另一个人在，过 2 分钟就去找他', () => {
  const s = { now: NOW, me: 'a', hostSince: NOW - 3 * MIN, meAway: true, meAwaySince: NOW - MIN, dtMs: MIN, notes: [], members: [mem('a'), mem('b')] };
  assert.equal(V.decide(s, () => 0.99), null);
  assert.deepEqual(V.decide({ ...s, meAwaySince: NOW - 3 * MIN }, () => 0.99), { to: 'b', reason: 'lonely', noteId: null });
});

test('接走：狗所在那台 3 分钟没动静，在线的人里心动值最高的那个接走', () => {
  const base = { now: NOW, host: 'a', hostSeenAt: NOW - 4 * MIN, members: [mem('a'), mem('b', { heart: 0.6 }), mem('c', { heart: 0.4 })] };
  assert.equal(V.shouldReclaim({ ...base, me: 'b' }), true);
  assert.equal(V.shouldReclaim({ ...base, me: 'c' }), false, '让给心动值高的');
  assert.equal(V.shouldReclaim({ ...base, me: 'b', hostSeenAt: NOW - MIN }), false, '那台还活着');
  assert.equal(V.shouldReclaim({ ...base, me: 'b', members: [mem('a'), mem('b', { activeAt: NOW - 10 * MIN })] }), false, '我自己也不在');
});

test('呼唤：有冷却，刚到别人那儿 5 分钟内叫不动，那台没动静时随时能叫', () => {
  const base = { now: NOW, me: 'a', host: 'b', hostSince: NOW - 2 * MIN, hostSeenAt: NOW, members: [mem('a'), mem('b')] };
  assert.equal(V.canCall(base).why, 'just-arrived');
  assert.equal(V.canCall({ ...base, hostSince: NOW - 6 * MIN }).ok, true);
  assert.equal(V.canCall({ ...base, hostSince: NOW - 6 * MIN, calledAt: NOW - MIN }).why, 'cooldown');
  assert.equal(V.canCall({ ...base, hostSeenAt: NOW - 5 * MIN }).ok, true);
  assert.equal(V.canCall({ ...base, host: 'a' }).why, 'here');
});

test('心动值：互动会涨，一天最多涨 0.15；不互动慢慢回到 0.3', () => {
  let h = { heart: 0.3, gainedToday: 0, day: 'd1' };
  for (let i = 0; i < 50; i++) h = V.heartAfter(h, 'pet', 'd1');
  assert.ok(Math.abs(h.heart - 0.45) < 1e-9, String(h.heart));
  h = V.heartAfter(h, 'pet', 'd2');
  assert.ok(Math.abs(h.heart - 0.47) < 1e-9, '第二天又能涨');
  assert.ok(V.heartAfter({ heart: 0.5, gainedToday: 0.15, day: 'd1' }, 'struggle', 'd1').heart < 0.5, '扣分不受上限');
  assert.ok(Math.abs(V.heartDrift(0.9, 10 * 24 * HOUR) - 0.7) < 1e-9);
  assert.equal(V.heartDrift(0.31, 10 * 24 * HOUR), 0.3);
  assert.equal(V.heartDrift(0.1, 30 * 24 * HOUR), 0.3);
});

test('收件人：两个人时默认寄给对方；@昵称 选人，正文去掉 @', () => {
  const ms = [mem('a', { nickname: '小明' }), mem('b', { nickname: '小红' })];
  assert.deepEqual(V.pickRecipient('早点睡', ms, 'a'), { to: 'b', text: '早点睡', error: null });
  const three = [...ms, mem('c', { nickname: '小红帽' })];
  assert.deepEqual(V.pickRecipient('@小红帽 晚上吃什么', three, 'a'), { to: 'c', text: '晚上吃什么', error: null }, '长名字优先');
  assert.deepEqual(V.pickRecipient('晚上吃什么 ＠小红', three, 'a'), { to: 'b', text: '晚上吃什么', error: null });
  assert.equal(V.pickRecipient('晚上吃什么', three, 'a').error, 'who');
  assert.equal(V.pickRecipient('嗨', [ms[0]], 'a').error, 'alone');
  // 没起名字的人：@ 不会误对上；两个人时照样默认寄给对方
  const unnamed = [mem('a', { nickname: '' }), mem('b', { nickname: '' })];
  assert.deepEqual(V.pickRecipient('@随便 早', unnamed, 'a'), { to: 'b', text: '@随便 早', error: null });
});

test('宠物码：12 位、四位一组、不含易混的字；输入时容忍空格横线和小写', () => {
  for (let i = 0; i < 200; i++) {
    const c = V.makeCode(n => crypto.randomBytes(n));
    assert.match(c, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    assert.equal(V.normCode(c.toLowerCase().replace(/-/g, ' ')), c.replace(/-/g, ''));
  }
  assert.equal(V.normCode('ABCD-EFGH-JKM0'), null, '0 不在字母表里');
  assert.equal(V.normCode('ABC'), null);
  assert.equal(V.cleanNickname('  @小明\n'), '小明');
  assert.equal(Array.from(V.cleanNickname('狗'.repeat(30))).length, 12);
});

test('加密：宠物码对了才解得开组钥；纸条换组、被改都解不开', () => {
  const key = C.newGroupKey(), code = 'ABCDEFGHJKMN';
  const wrapped = C.wrapKey(key, code);
  assert.ok(C.unwrapKey(wrapped, code).equals(key));
  assert.equal(C.unwrapKey(wrapped, 'ABCDEFGHJKMP'), null);
  const body = C.seal(key, '今天也要开心 🐶', 'pet-1');
  assert.ok(!body.includes('开心'));
  assert.equal(C.open(key, body, 'pet-1'), '今天也要开心 🐶');
  assert.equal(C.open(key, body, 'pet-2'), null, '贴到别的组');
  const parts = body.split('.'); parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('A') ? 'BB' : 'AA');
  assert.equal(C.open(key, parts.join('.'), 'pet-1'), null, '被改过');
  assert.equal(C.open(C.newGroupKey(), body, 'pet-1'), null, '钥匙不对');
});

test('几台电脑：这台正在用、狗那台闲着才把它接过来', () => {
  const now = 10_000_000, fresh = { activeAt: now - 30_000, seenAt: now - 10_000 };
  assert.equal(V.shouldFollow({ now, idleSec: 5, hostDevice: fresh }), false, '那台正有人用：不抢');
  assert.equal(V.shouldFollow({ now, idleSec: 5, hostDevice: { activeAt: now - 120_000, seenAt: now - 10_000 } }), true, '那台闲了 2 分钟：接过来');
  assert.equal(V.shouldFollow({ now, idleSec: 5, hostDevice: { activeAt: now - 30_000, seenAt: now - 4 * 60_000 } }), true, '那台 4 分钟没动静（关机、断网）：接过来');
  assert.equal(V.shouldFollow({ now, idleSec: 120, hostDevice: { activeAt: now - 600_000, seenAt: now - 10_000 } }), false, '这台也没人用：不动');
  assert.equal(V.shouldFollow({ now, idleSec: 5, hostDevice: null }), true, '找不到那台的记录：接过来');
});

test('它在别人那儿干嘛：认得的动作给一句话，不认得的不说', () => {
  assert.equal(V.doingText('sleep'), '在睡觉');
  assert.equal(V.doingText('held'), '被拎着玩');
  assert.equal(V.doingText('whatever'), '');
  assert.equal(V.doingText(undefined), '');
});
