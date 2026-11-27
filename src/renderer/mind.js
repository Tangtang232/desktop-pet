// 心情和困意：慢慢变化的内部状态。平时挂什么表情、多久眨一次眼、什么时候打哈欠歪头、
// 什么时候睡着、睡多久，都从这里推出来，不再每换一个动作随机抽一个表情。
// 页面里通过 window.PetMind 用，测试里用 require。时间单位都是秒。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetMind = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (dt, tau) => 1 - Math.exp(-dt / tau);   // 每秒朝目标走多少，和帧率无关

  // val：开不开心（-1 委屈 … 1 很开心）；aro：兴奋程度（0 懒洋洋 … 1 很兴奋）
  // drowsy：困意（0 清醒 … 1 睡着）；groggy：刚醒那股迷糊劲儿，慢慢散；expr：现在挂的表情，exprT：换上它的时间
  function initMind() {
    return { val: 0.3, aro: 0.45, drowsy: 0, groggy: 0, expr: 'neutral', exprT: -99 };
  }

  // ---------- 事件：给心情推一下，之后自己慢慢回到常态 ----------
  // [开心, 兴奋]。兴奋的事顺带把困意打散
  const KICK = {
    poke: [0.05, 0.35],       // 被戳了一下
    pickup: [0, 0.35],        // 被拎起来
    land: [-0.05, 0.15],      // 落地
    fed: [0.2, 0.25],         // 听见倒粮
    ate: [0.25, -0.1],        // 吃饱
    greet: [0.45, 0.45],      // 你回来了
    play: [0.25, 0.3],        // 求关注时你理它了
    ignored: [-0.4, -0.1],    // 求关注没人理
    noteArrive: [0.1, 0.25],  // 有纸条来了
    noteRead: [0.2, 0.1],     // 你看了它叼来的纸条
    woken: [-0.1, 0.3]        // 睡着时被弄醒
  };
  function kick(m, ev) {
    const k = KICK[ev];
    if (!k) return m;
    m.val = clamp(m.val + k[0], -1, 1);
    m.aro = clamp(m.aro + k[1], 0, 1);
    if (k[1] > 0) m.drowsy = Math.max(0, m.drowsy - k[1] * 1.5);
    return m;
  }
  // 刚睡醒：迷糊一阵，困意不会一下子没了
  function wake(m, how) {
    m.groggy = how === 'startled' ? 0.45 : 0.85;
    m.drowsy = Math.max(m.drowsy, m.groggy);
    return m;
  }

  const HUNGER_SAD = { fed: 0, peckish: 0.1, hungry: 0.35, starving: 0.7 };
  // 困意的来源：累（晚上更累）× 姿势（趴着最容易困，走着不会）× 安不安静（有人逗它就困不起来）
  const POSTURE_DROWSY = { lie: 1, sit: 0.55, stand: 0.3, move: 0 };
  function sleepPressure(energy, night) {
    return clamp((1 - energy) * (night ? 1.4 : 1) * 1.3 - 0.25, 0, 1);
  }

  // c：{ energy, boredom, attention, hunger(饿的档位), night, userPresent,
  //      dozing(正在入睡), asleep(已经睡着), posture('lie'|'sit'|'stand'|'move'), quiet(附近没动静), petting, heldFor(被拎了几秒，没拎是 -1) }
  function tickMind(m, dt, c) {
    if (!(dt > 0)) return m;
    const energy = c.energy == null ? 0.8 : c.energy, boredom = c.boredom || 0, attention = c.attention || 0;
    // 困意
    if (c.asleep) m.drowsy = 1;
    else if (c.dozing) m.drowsy += (1 - m.drowsy) * ease(dt, 4);   // 正在入睡：十来秒眼皮越来越沉
    else {
      const target = Math.max(m.groggy, sleepPressure(energy, c.night) * (POSTURE_DROWSY[c.posture] || 0) * (c.quiet ? 1 : 0.35));
      // 困起来慢（二十来秒），被动静弄精神快（几秒）
      m.drowsy += (target - m.drowsy) * ease(dt, target > m.drowsy ? 20 : 3);
    }
    m.groggy = Math.max(0, m.groggy - dt / 25);
    m.drowsy = clamp(m.drowsy, 0, 1);
    // 心情的常态：饿、没人理、闷久了都会低落；精神好、闲得慌会更兴奋
    const v0 = 0.3 - (HUNGER_SAD[c.hunger] || 0) - (c.userPresent ? Math.max(0, attention - 0.55) * 0.6 : 0) - Math.max(0, boredom - 0.7) * 0.5;
    const a0 = c.asleep ? 0.05 : clamp(0.15 + 0.45 * energy + 0.25 * boredom * energy - 0.35 * m.drowsy, 0.05, 0.9);
    m.val += (v0 - m.val) * ease(dt, 45);   // 开心难过散得慢
    m.aro += (a0 - m.aro) * ease(dt, 10);   // 兴奋劲儿散得快
    if (c.petting) { m.val += dt * 0.12; m.aro += (0.35 - m.aro) * ease(dt, 2); }   // 被摸：越摸越舒服，人也松下来
    if (c.heldFor >= 0) {
      m.aro += (0.75 - m.aro) * ease(dt, 1.5);
      if (c.heldFor > 2.5) m.val -= dt * 0.12;   // 拎久了不乐意
    }
    m.val = clamp(m.val, -1, 1);
    m.aro = clamp(m.aro, 0, 1);
    return m;
  }

  // ---------- 表情：由心情和困意定，换了以后至少挂几秒，在边界上不来回跳 ----------
  const HOLD = 3;
  // 继续挂着现在这个表情的条件（比换上它的条件宽一点，这就是回差）
  const KEEP = {
    sleepy: m => m.drowsy > 0.42,
    sad: m => m.val < -0.2,
    happy: m => m.val > 0.35 && m.aro > 0.42,
    content: m => m.val > 0.15 && m.aro < 0.52,
    neutral: () => false
  };
  function moodExpr(m) {
    if (m.drowsy > 0.55) return 'sleepy';
    if (m.val < -0.3) return 'sad';
    if (m.val > 0.45 && m.aro > 0.5) return 'happy';
    if (m.val > 0.25 && m.aro < 0.42) return 'content';
    return 'neutral';
  }
  function exprFor(m, t) {
    const want = moodExpr(m);
    if (want !== m.expr) {
      const keep = KEEP[m.expr] && KEEP[m.expr](m);
      // 犯困压过别的：眼皮沉了马上看得出来；其余的要等挂够时间、并且确实出了回差范围才换
      if (want === 'sleepy' || (!keep && t - m.exprT >= HOLD)) { m.expr = want; m.exprT = t; }
    }
    return m.expr;
  }

  // ---------- 眨眼：专心看东西时眨得少，困了眨得勤、闭得久 ----------
  // 返回 [离下次眨眼的秒数, 这次眨眼闭多久]
  function nextBlink(m, focused, rnd) {
    const r = rnd || Math.random;
    if (r() < 0.12 * (1 - m.drowsy)) return [0.3, 0.2];   // 偶尔连眨两下
    let gap = 2.4 + r() * 3.1;
    if (focused) gap *= 1.6;
    gap *= 1 - 0.45 * m.drowsy;
    const dur = 0.2 + (m.drowsy > 0.5 ? (m.drowsy - 0.5) * 2 * (0.5 + r() * 0.7) : 0);   // 犯困时一闭就是大半秒到一秒多
    return [gap, dur];
  }

  // ---------- 小动作的起因：每秒发生的概率 ----------
  // 打哈欠跟困有关；蹦跳只在又兴奋又开心时有；歪头是对动静的反应（你的鼠标在它跟前动）；
  // 抖毛、伸懒腰由起身、落地这些事件触发，不在这里随机
  function onceRates(m, c) {
    const r = {};
    const a = c.action;
    if (!['walk', 'idle', 'sit', 'lie', 'sniff'].includes(a) || c.moving) return r;
    r.yawn = 0.004 + 0.035 * m.drowsy + (m.groggy > 0.2 ? 0.03 : 0);
    if (a === 'walk' || a === 'idle') {
      if (m.val > 0.4 && m.aro > 0.68) r.hop = 0.06;
      if (c.watching && m.drowsy < 0.4) r.tilt = 0.012;
    } else if (a === 'sit') {
      if (c.watching && m.drowsy < 0.4) r.tilt = 0.015;
    }
    return r;
  }
  function pickOnce(rates, dt, rnd) {
    const r = rnd || Math.random;
    for (const k of Object.keys(rates)) if (r() < rates[k] * dt) return k;
    return null;
  }

  // ---------- 睡多久：人在时打个盹（越累睡越久），人不在时一直睡到你回来 ----------
  function napLength(energy, userPresent, rnd) {
    if (!userPresent) return Infinity;
    const r = rnd || Math.random;
    return clamp(40 + 200 * (1 - energy), 40, 180) * (0.8 + 0.4 * r());
  }

  return { initMind, KICK, kick, wake, tickMind, sleepPressure, moodExpr, exprFor, HOLD, nextBlink, onceRates, pickOnce, napLength };
});
