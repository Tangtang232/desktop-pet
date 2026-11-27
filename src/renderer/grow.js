// 养成（M3 第一版）：先天特质、后天性格、胖瘦、日记里的话。只有规则（不碰画面、不联网），页面和测试都用它。
// 规矩见 docs/PRD.md 3.4：特质有得有失、不分好坏，有些藏着、养着养着才发现；性格几个人一起影响；长期吃撑才会胖。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetGrow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const DAY = 24 * 3600;

  // ---------- 先天特质 ----------
  // 每样是 -1..1 的一个数，0 是一般。同一个种子永远算出同一套：合养的狗用宠物 id 当种子（组里每台电脑算出来一样），
  // 单机的狗第一次运行时随机一个种子记进存档
  const TRAITS = ['stomach', 'appetite', 'energy', 'clingy', 'curious'];
  function seedFrom(str) {
    let h = 0x811c9dc5;
    for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // 三个随机数取平均：大多数狗靠近一般，特别贪吃、特别黏人的少一些
  function traitsFromSeed(seed) {
    const r = rng(seed), out = {};
    for (const k of TRAITS) out[k] = Math.round(clamp(((r() + r() + r()) / 3 - 0.5) * 2.6, -1, 1) * 100) / 100;
    return out;
  }

  // 特质和性格怎么改它的日子（每样都有得有失）：
  //   stomach 胃大：一顿吃得多、扛饿（消化慢），但容易吃撑、长胖；胃小：饿得快，吃几口就饱
  //   appetite 贪吃：不饿也爱去碗边，吃到更撑才停；不贪吃：挑嘴，饿了才认真吃
  //   energy 活泼：走得多、爱邀你玩，但累得快；慵懒：爱趴着，精力掉得慢
  //   clingy 黏人：想被理涨得快、常来找你，没人理也更委屈；独立：自己玩得好，不常来找你
  //   curious 好奇：爱闻地面、你的鼠标一动就看；不好奇：淡定
  //   性格 warmth 亲人：更想被理、你回来更开心；boldness 胆大：被戳一下吓得轻
  function effects(traits, persona) {
    const t = traits || {}, p = persona || {};
    const v = k => (typeof t[k] === 'number' ? t[k] : 0);
    return {
      digestMul: 1 - 0.2 * v('stomach'),
      fullAt: clamp(0.96 + 0.03 * v('appetite') - 0.04 * Math.max(0, -v('stomach')), 0.88, 0.99),
      snackMul: 1 + 1.5 * Math.max(0, v('appetite')) - 0.6 * Math.max(0, -v('appetite')),
      drainMul: 1 + 0.35 * v('energy'),
      walkMul: 1 + 0.5 * v('energy'),
      lieMul: 1 - 0.4 * v('energy'),
      attentionMul: clamp(1 + 0.6 * v('clingy') + 0.3 * (p.warmth || 0), 0.3, 2),
      sniffMul: 1 + 0.8 * v('curious'),
      startleMul: clamp(1 - 0.4 * (p.boldness || 0), 0.5, 1.5)
    };
  }

  // ---------- 后天性格：几个人一起养出来的 ----------
  // warmth 亲人：被摸、陪玩、来找你时被回应慢慢变亲；求关注被晾着、拎着挣扎时慢慢变冷淡
  // boldness 胆大：陪它玩、轻轻放下慢慢变大胆；老被戳、被拎得挣扎吓得胆小
  // 一天最多变 0.08；不互动时很慢地回到中间（一周回一半）
  const PERSONA_GAIN = {
    pet: [0.006, 0], play: [0.008, 0.004], answer: [0.01, 0.002], feed: [0.004, 0],
    ignored: [-0.012, 0], struggle: [-0.004, -0.006], poke: [0, -0.006], land: [0, 0.003]
  };
  const PERSONA_DAILY_CAP = 0.08;
  function initPersona() { return { warmth: 0, boldness: 0, day: '', movedToday: 0 }; }
  function personaAfter(p, kind, day) {
    const g = PERSONA_GAIN[kind];
    const out = Object.assign(initPersona(), p || {});
    if (!g) return out;
    if (out.day !== day) { out.day = day; out.movedToday = 0; }
    const room = PERSONA_DAILY_CAP - out.movedToday;
    if (room <= 0) return out;
    const k = Math.min(1, room / (Math.abs(g[0]) + Math.abs(g[1]) || 1));
    out.warmth = clamp(out.warmth + g[0] * k, -1, 1);
    out.boldness = clamp(out.boldness + g[1] * k, -1, 1);
    out.movedToday += (Math.abs(g[0]) + Math.abs(g[1])) * k;
    return out;
  }
  function personaDrift(p, sec) {
    const out = Object.assign(initPersona(), p || {});
    const f = Math.pow(0.5, Math.max(0, sec) / (7 * DAY));
    out.warmth *= f; out.boldness *= f;
    return out;
  }

  // ---------- 胖瘦：-1 瘦 … 0 正好 … 1 胖 ----------
  // 长期吃撑（肚子九成二以上）才长胖，一直撑着大约五天胖满一档；饿着、走路慢慢瘦回来
  function weightTick(w, sec, ctx) {
    let d = 0;
    if (ctx.belly > 0.92) d += sec / (5 * DAY);
    if (ctx.belly < 0.15) d -= sec / (4 * DAY);
    if (ctx.walking) d -= sec / (8 * DAY);
    return clamp((typeof w === 'number' ? w : 0) + d, -1, 1);
  }
  const weightWord = w => (w > 0.6 ? '胖乎乎的' : w > 0.25 ? '有点圆了' : w < -0.6 ? '瘦了不少' : w < -0.25 ? '有点瘦' : '');

  // ---------- 特质慢慢被发现 ----------
  // 每样特质要攒够"证据"才会在日记里写出来（不是一来就告诉你它是什么样的狗）
  const CLUES = {
    stomach: { need: 6, hi: '它一顿能吃好多，好像很扛饿', lo: '它吃几口就饱了，饿得也快' },
    appetite: { need: 8, hi: '不饿也老往碗边凑，是个小馋鬼', lo: '它挺挑嘴，不饿不怎么吃' },
    energy: { need: 10, hi: '精力旺盛，走来走去停不下来', lo: '它很会享受，能趴着绝不站着' },
    clingy: { need: 6, hi: '特别黏人，一会儿没人理就来找', lo: '挺独立的，自己玩得很好' },
    curious: { need: 10, hi: '好奇心重，什么都要闻一闻', lo: '它很淡定，什么都不太在意' }
  };
  // clues：{ 特质: 次数 }，known：已经写进日记的特质。返回新发现的 [{trait, text}]
  function discover(traits, clues, known) {
    const out = [];
    for (const k of TRAITS) {
      const t = traits && traits[k];
      if (known && known.includes(k)) continue;
      if (typeof t !== 'number' || Math.abs(t) < 0.35) continue;       // 一般的不算特点
      if (((clues && clues[k]) || 0) < CLUES[k].need) continue;
      out.push({ trait: k, text: t > 0 ? CLUES[k].hi : CLUES[k].lo });
    }
    return out;
  }

  // ---------- 存档 ----------
  function initGrow(seed) {
    return { v: 1, seed: seed >>> 0, born: Date.now(), persona: initPersona(), weight: 0, clues: {}, known: [], words: {} };
  }
  function sanitizeGrow(g) {
    if (!g || typeof g !== 'object' || !Number.isFinite(g.seed)) return null;
    const p = g.persona && typeof g.persona === 'object' ? g.persona : {};
    const num = (v, a, b, d) => (typeof v === 'number' && isFinite(v) ? clamp(v, a, b) : d);
    const clues = {};
    for (const k of TRAITS) clues[k] = num(g.clues && g.clues[k], 0, 1e6, 0);
    return {
      v: 1, seed: g.seed >>> 0, born: num(g.born, 0, 9e15, Date.now()),
      persona: { warmth: num(p.warmth, -1, 1, 0), boldness: num(p.boldness, -1, 1, 0), day: typeof p.day === 'string' ? p.day.slice(0, 10) : '', movedToday: num(p.movedToday, 0, 1, 0) },
      weight: num(g.weight, -1, 1, 0), clues,
      known: Array.isArray(g.known) ? g.known.filter(k => TRAITS.includes(k)) : [],
      words: g.words && typeof g.words === 'object' ? { weight: typeof g.words.weight === 'string' ? g.words.weight.slice(0, 12) : '', warmth: typeof g.words.warmth === 'string' ? g.words.warmth.slice(0, 12) : '', age: num(g.words.age, 0, 1e5, 0) } : {}
    };
  }
  // 几天大了（按真实时间）
  const ageDays = (g, nowMs) => Math.max(0, Math.floor(((nowMs || Date.now()) - ((g && g.born) || Date.now())) / (DAY * 1000)));
  const warmthWord = w => (w > 0.5 ? '越来越亲人了' : w < -0.5 ? '好像有点冷淡' : '');
  // 值得记一笔的日子：来了一周、一个月、一百天、一年……
  const AGE_MARKS = [7, 30, 100, 200, 365, 730, 1000];
  const ageMark = (days, last) => AGE_MARKS.filter(d => d <= days && d > (last || 0)).pop() || 0;

  return {
    TRAITS, seedFrom, traitsFromSeed, effects,
    PERSONA_GAIN, PERSONA_DAILY_CAP, initPersona, personaAfter, personaDrift,
    weightTick, weightWord, warmthWord, AGE_MARKS, ageMark, CLUES, discover, initGrow, sanitizeGrow, ageDays
  };
});
