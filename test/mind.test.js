const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/renderer/mind.js');

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 按固定场景跑 sec 秒，每步 dt
function run(m, sec, c, dt = 0.1) {
  for (let t = 0; t < sec; t += dt) M.tickMind(m, dt, c);
  return m;
}
const calm = { energy: 0.8, boredom: 0.2, attention: 0.2, hunger: 'fed', userPresent: true, posture: 'stand', quiet: true, heldFor: -1 };

test('表情：心情在门槛附近小幅晃，表情不跟着跳；大起大落时换一次也至少挂 3 秒', () => {
  const swing = (amp) => {
    const m = M.initMind();
    let t = 0, last = M.exprFor(m, t), lastAt = -99, changes = 0, minGap = Infinity;
    for (let i = 0; i < 600; i++) {
      t += 0.1;
      m.val = 0.45 + amp * Math.sin(t * 5); m.aro = 0.55 + amp * Math.sin(t * 3.7);
      const e = M.exprFor(m, t);
      if (e !== last) { changes++; minGap = Math.min(minGap, t - lastAt); last = e; lastAt = t; }
    }
    return { changes, minGap };
  };
  const small = swing(0.06);
  assert.ok(small.changes <= 1, '小幅晃 ' + JSON.stringify(small));
  const big = swing(0.5);
  assert.ok(big.minGap >= M.HOLD - 1e-9, '大起大落 ' + JSON.stringify(big));
});

test('表情：困了马上看得出来，不用等挂够时间', () => {
  const m = M.initMind();
  M.exprFor(m, 0);
  m.val = 0.6; m.aro = 0.7; assert.equal(M.exprFor(m, 3.5), 'happy');
  m.drowsy = 0.7; assert.equal(M.exprFor(m, 3.6), 'sleepy');
});

test('困意：累了趴着、周围安静会越来越困；走着、有人逗就困不起来', () => {
  const tired = { ...calm, energy: 0.15, posture: 'lie' };
  const lying = run(M.initMind(), 60, tired);
  assert.ok(lying.drowsy > 0.6, '趴一分钟 ' + lying.drowsy.toFixed(2));
  const early = run(M.initMind(), 5, tired);
  assert.ok(early.drowsy < 0.3, '不是一趴下就困 ' + early.drowsy.toFixed(2));
  assert.ok(run(M.initMind(), 60, { ...tired, posture: 'move' }).drowsy < 0.01);
  assert.ok(run(M.initMind(), 60, { ...tired, quiet: false }).drowsy < lying.drowsy * 0.5);
  const fresh = run(M.initMind(), 60, { ...calm, energy: 0.9, posture: 'lie' });
  assert.ok(fresh.drowsy < 0.05, '有精神时趴着也不困 ' + fresh.drowsy.toFixed(2));
  // 犯困了被逗：几秒就精神了
  const poked = run(lying, 4, { ...tired, quiet: false });
  assert.ok(poked.drowsy < 0.45, '被逗以后 ' + poked.drowsy.toFixed(2));
});

test('困意：晚上更容易困', () => {
  const c = { ...calm, energy: 0.5, posture: 'lie' };
  assert.ok(run(M.initMind(), 90, { ...c, night: true }).drowsy > run(M.initMind(), 90, c).drowsy + 0.2);
});

test('入睡：十来秒眼皮越来越沉，不是一下子睡着', () => {
  const m = M.initMind();
  run(m, 2, { ...calm, dozing: true });
  assert.ok(m.drowsy > 0.2 && m.drowsy < 0.6, '2 秒 ' + m.drowsy.toFixed(2));
  run(m, 10, { ...calm, dozing: true });
  assert.ok(m.drowsy > 0.9, '12 秒 ' + m.drowsy.toFixed(2));
});

test('睡醒：迷糊一阵，十几秒后才完全清醒；被吓醒的迷糊得短', () => {
  const m = M.wake(M.initMind());
  assert.ok(m.drowsy >= 0.8);
  run(m, 8, { ...calm, posture: 'stand', quiet: false });
  assert.ok(m.drowsy > 0.42, '8 秒还有点迷糊 ' + m.drowsy.toFixed(2));
  run(m, 20, { ...calm, posture: 'stand', quiet: false });
  assert.ok(m.drowsy < 0.15, '28 秒清醒了 ' + m.drowsy.toFixed(2));
  const s = M.wake(M.initMind(), 'startled');
  run(s, 5, { ...calm, posture: 'stand', quiet: false });
  assert.ok(s.drowsy < 0.42, '吓醒 5 秒 ' + s.drowsy.toFixed(2));
});

test('心情：饿久了低落，常态下不委屈；被摸越来越开心', () => {
  assert.equal(M.moodExpr(run(M.initMind(), 300, calm)), 'neutral');
  const starving = run(M.initMind(), 300, { ...calm, hunger: 'starving' });
  assert.equal(M.moodExpr(starving), 'sad');
  const petted = run(M.initMind(), 15, { ...calm, petting: true });
  assert.ok(petted.val > 0.9 && petted.aro < 0.45, JSON.stringify(petted));
  assert.equal(M.moodExpr(petted), 'content');
});

test('心情：事件推一下，之后自己回到常态', () => {
  const m = M.kick(run(M.initMind(), 200, calm), 'greet');
  assert.equal(M.moodExpr(m), 'happy');
  run(m, 240, calm);
  assert.equal(M.moodExpr(m), 'neutral');
  const sulk = M.kick(run(M.initMind(), 200, { ...calm, attention: 0.95 }), 'ignored');
  assert.equal(M.moodExpr(sulk), 'sad', JSON.stringify(sulk));
});

test('心情：拎久了不乐意', () => {
  const m = M.initMind();
  for (let h = 0; h < 6; h += 0.1) M.tickMind(m, 0.1, { ...calm, heldFor: h });
  assert.ok(m.val < 0 && m.aro > 0.6, JSON.stringify(m));
});

test('眨眼：盯着看时眨得少，犯困时一闭就是大半秒', () => {
  const avg = (m, focused) => { const r = seeded(7); let g = 0, d = 0; for (let i = 0; i < 2000; i++) { const [a, b] = M.nextBlink(m, focused, r); g += a; d += b; } return [g / 2000, d / 2000]; };
  const awake = M.initMind(), sleepy = { ...M.initMind(), drowsy: 0.9 };
  assert.ok(avg(awake, true)[0] > avg(awake, false)[0] * 1.3);
  assert.ok(avg(sleepy, false)[0] < avg(awake, false)[0]);
  assert.ok(avg(sleepy, false)[1] > 0.5 && avg(awake, false)[1] < 0.25, JSON.stringify([avg(sleepy, false), avg(awake, false)]));
});

test('小动作有起因：平静时很少，犯困常打哈欠，开心兴奋才蹦，鼠标在跟前才歪头', () => {
  const m = M.initMind();
  const r0 = M.onceRates(m, { action: 'idle' });
  assert.ok(r0.yawn < 0.01 && !r0.hop && !r0.tilt, JSON.stringify(r0));
  const sleepy = M.onceRates({ ...m, drowsy: 0.8 }, { action: 'sit' });
  assert.ok(sleepy.yawn > r0.yawn * 5);
  assert.ok(M.onceRates({ ...m, val: 0.7, aro: 0.8 }, { action: 'idle' }).hop > 0);
  assert.ok(M.onceRates(m, { action: 'sit', watching: true }).tilt > 0);
  assert.deepEqual(M.onceRates(m, { action: 'walk', moving: true }), {});
  assert.deepEqual(M.onceRates(m, { action: 'eat' }), {});
  // 平静地站一小时，小动作加起来不到一分钟一次
  const rnd = seeded(3); let n = 0;
  for (let t = 0; t < 3600; t += 0.1) if (M.pickOnce(M.onceRates(m, { action: 'idle' }), 0.1, rnd)) n++;
  assert.ok(n < 60, `一小时 ${n} 次`);
});

test('打盹：人在时越累睡越久（不超过 3 分钟多一点），人不在一直睡', () => {
  const r = seeded(1);
  const tired = M.napLength(0.1, true, r), fresh = M.napLength(0.9, true, r);
  assert.ok(tired > fresh && tired <= 180 * 1.2 && fresh >= 40 * 0.8, `${tired} ${fresh}`);
  assert.equal(M.napLength(0.5, false), Infinity);
});
