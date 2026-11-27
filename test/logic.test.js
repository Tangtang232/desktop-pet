const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/renderer/logic.js');

// 固定的伪随机数，让抽样结果可重复
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sample(cur, needs, ctx, n = 4000) {
  const rnd = seeded(42);
  const c = {};
  for (let i = 0; i < n; i++) {
    const k = L.chooseNext(cur, needs, ctx, rnd);
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

test('一碗粮醒着大约 8 小时消化完，睡着慢一半', () => {
  assert.ok(Math.abs(L.digestRate(false) * 8 * 3600 - 1) < 1e-9);
  assert.ok(Math.abs(L.digestRate(true) - L.digestRate(false) / 2) < 1e-12);
});

test('饥饿分四档，边界落在对的一档', () => {
  assert.equal(L.hungerStage(1), 'fed');
  assert.equal(L.hungerStage(0.3), 'fed');
  assert.equal(L.hungerStage(0.29), 'peckish');
  assert.equal(L.hungerStage(0.18), 'peckish');
  assert.equal(L.hungerStage(0.17), 'hungry');
  assert.equal(L.hungerStage(0.08), 'hungry');
  assert.equal(L.hungerStage(0.05), 'starving');
  assert.equal(L.hungerStage(0), 'starving');
});

test('需求：醒着精力掉，睡觉回，晚上掉得更快，都夹在 0 到 1', () => {
  const n0 = L.initNeeds();
  const awake = L.tickNeeds(n0, 600, { active: true });
  assert.ok(awake.energy < n0.energy);
  const night = L.tickNeeds(n0, 600, { active: true, night: true });
  assert.ok(night.energy < awake.energy);
  const slept = L.tickNeeds({ energy: 0.1, boredom: 0.5, attention: 0.5 }, 3600, { sleeping: true });
  assert.ok(slept.energy > 0.1);
  const big = L.tickNeeds(n0, 1e7, { sleeping: true });
  for (const k of ['energy', 'boredom', 'attention']) assert.ok(big[k] >= 0 && big[k] <= 1, k);
});

test('需求：被摸会消掉"想被理"，人在却不理会慢慢涨', () => {
  const n = { energy: 0.8, boredom: 0.2, attention: 0.6 };
  assert.ok(L.tickNeeds(n, 2, { interacted: true }).attention < 0.6);
  assert.ok(L.tickNeeds(n, 60, { userPresent: true }).attention > 0.6);
  assert.ok(L.tickNeeds(n, 60, { userPresent: false }).attention < 0.6);
});

test('自由活动：累了更常趴和睡，不会选回当前姿势', () => {
  const tired = sample('lie', { energy: 0.05, boredom: 0.1, attention: 0 }, {});
  const fresh = sample('lie', { energy: 0.95, boredom: 0.1, attention: 0 }, {});
  assert.ok((tired.sleep || 0) > (fresh.sleep || 0) * 3, JSON.stringify({ tired, fresh }));
  assert.equal(tired.lie, undefined);
});

test('自由活动：无聊又有精神时更常邀你玩；人不在、刚睡醒迷糊时很少邀玩', () => {
  const here = { userPresent: true };
  const bored = sample('idle', { energy: 0.9, boredom: 0.95, attention: 0 }, here);
  const calm = sample('idle', { energy: 0.9, boredom: 0.0, attention: 0 }, here);
  assert.ok((bored.bow || 0) > (calm.bow || 0) + 300, JSON.stringify({ bored, calm }));
  const alone = sample('idle', { energy: 0.9, boredom: 0.95, attention: 0 }, {});
  assert.ok((alone.bow || 0) < (bored.bow || 0) / 3, JSON.stringify({ alone, bored }));
  const groggy = sample('idle', { energy: 0.9, boredom: 0.95, attention: 0 }, { userPresent: true, drowsy: 0.6 });
  assert.equal(groggy.bow, undefined);
});

test('自由活动：人在且很想被理时会去找你，人不在时不会', () => {
  const needy = { energy: 0.8, boredom: 0.2, attention: 0.9 };
  assert.ok((sample('idle', needy, { userPresent: true }).seek || 0) > 1000);
  assert.equal(sample('idle', needy, { userPresent: false }).seek, undefined);
  assert.equal(sample('idle', needy, { userPresent: true, seekCooldown: true }).seek, undefined, '刚被晾过，先不来');
});

test('需求：人在却没人理，"想被理"大约 20 分钟才攒到想去找你', () => {
  const n = { energy: 0.8, boredom: 0.2, attention: 0 };
  assert.ok(L.tickNeeds(n, 8 * 60, { userPresent: true }).attention < 0.45);
  assert.ok(L.tickNeeds(n, 12 * 60, { userPresent: true }).attention > 0.45);
});

test('人离开电脑：默认 5 分钟没动算离开，可以改阈值', () => {
  assert.equal(L.isAway(299), false);
  assert.equal(L.isAway(300), true);
  assert.equal(L.isAway(25, 20), true);
});

test('离开期间结算：按时长消化，时钟往回拨不出错', () => {
  const base = L.sanitizeState({ v: 1, savedAt: 1_000_000, belly: 0.8, food: 0.2, x: 0.5 });
  const after4h = L.settleAway(base, 1_000_000 + 4 * 3600 * 1000);
  assert.ok(Math.abs(after4h.belly - (0.8 - 0.5 * 0.75)) < 1e-9, String(after4h.belly));
  const back = L.settleAway(base, 1_000_000 - 3600 * 1000);
  assert.equal(back.belly, 0.8);
  const week = L.settleAway(base, 1_000_000 + 7 * 24 * 3600 * 1000);
  assert.equal(week.belly, 0);
  assert.ok(week.needs.energy <= 1 && week.needs.attention <= 1);
});

test('存档校验：坏数据被拒或被夹回范围', () => {
  assert.equal(L.sanitizeState(null), null);
  assert.equal(L.sanitizeState({ v: 2, savedAt: 1 }), null);
  assert.equal(L.sanitizeState({ v: 1 }), null);
  const s = L.sanitizeState({ v: 1, savedAt: 5, belly: 7, food: -3, x: NaN, facing: 9, needs: { energy: 'a' }, groundNote: { text: '  hi  ', x: 2 } });
  assert.equal(s.belly, 1);
  assert.equal(s.food, 0);
  assert.equal(s.x, 0.3);
  assert.equal(s.facing, 1);
  assert.equal(s.needs.energy, 0.8);
  assert.deepEqual(s.groundNote, { text: 'hi', x: 1 });
});

test('存档校验：纸条保留"没看"标记，坏字段被清掉', () => {
  const s = L.sanitizeState({ v: 1, savedAt: 5, notes: [{ text: ' 你好 ', at: 3, unread: true }, { text: 'b', unread: 'yes' }, { nope: 1 }, null] });
  assert.deepEqual(s.notes, [{ text: '你好', at: 3, unread: true }, { text: 'b', at: 0, unread: false }]);
});

test('狗的大小：按工作区高度的 13%，限制在 110 到 220', () => {
  assert.equal(L.petHeightFor(1040), 1040 * 0.13);
  assert.equal(L.petHeightFor(500), 110);
  assert.equal(L.petHeightFor(3000), 220);
  assert.equal(L.petHeightFor(NaN), 130);
});

test('全屏检测：全屏程序、全屏游戏、放映时躲，其他状态不躲', () => {
  for (const q of [2, 3, 4]) assert.equal(L.shouldHideFor(q), true, String(q));
  for (const q of [0, 1, 5, 6, 7]) assert.equal(L.shouldHideFor(q), false, String(q));
});

test('全屏检测：前台窗口盖住整块屏幕才算', () => {
  const mon = { left: 0, top: 0, right: 2560, bottom: 1440 };
  assert.equal(L.coversMonitor({ left: 0, top: 0, right: 2560, bottom: 1440 }, mon), true);
  assert.equal(L.coversMonitor({ left: -1, top: -1, right: 2561, bottom: 1441 }, mon), true);
  assert.equal(L.coversMonitor({ left: 0, top: 0, right: 2560, bottom: 1380 }, mon), false, '最大化但没盖住任务栏');
  assert.equal(L.coversMonitor(null, mon), false);
});

test('纸条：去控制字符、合并空行、截到 120 个字', () => {
  assert.equal(L.cleanNote('  你好\u0007呀  '), '你好呀');
  assert.equal(L.cleanNote('a\r\n\r\n\r\n\r\nb'), 'a\n\nb');
  assert.equal(L.cleanNote('狗'.repeat(200)).length, 120);
  assert.equal(L.cleanNote(42), '');
  assert.equal(Array.from(L.cleanNote('🐶'.repeat(130))).length, 120);
});

test('自由活动：只会从趴着犯困睡过去，坐着不会直接睡', () => {
  const tired = { energy: 0.05, boredom: 0.1, attention: 0 };
  assert.equal(sample('sit', tired, { night: true }).sleep, undefined);
  assert.ok((sample('lie', tired, { night: true }).sleep || 0) > 1000);
});
