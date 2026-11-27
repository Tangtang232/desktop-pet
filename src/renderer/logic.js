// 和画面无关的规则：消化、饥饿程度、需求、下一步做什么、离开期间的结算、存档校验、纸条文字。
// 页面里通过 window.PetLogic 用，测试里用 require。时间单位都是秒（真实时间）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const HOUR = 3600;

  // ---------- 消化 ----------
  const DIGEST_FULL_HOURS = 8; // 一碗粮大约 8 小时消化完
  function digestRate(sleeping) {
    return (sleeping ? 0.5 : 1) / (DIGEST_FULL_HOURS * HOUR);
  }

  // ---------- 饥饿程度：不给用户看数字，只决定它的表现 ----------
  // fed：正常；peckish：偶尔瞟一眼碗；hungry：去碗边坐着等；starving：等得委屈了
  function hungerStage(belly) {
    if (belly >= 0.3) return 'fed';
    if (belly >= 0.18) return 'peckish';
    if (belly >= 0.08) return 'hungry';
    return 'starving';
  }

  // ---------- 三个看不见的需求 ----------
  // energy 精力：醒着慢慢掉，晚上掉得快，睡觉回；boredom 无聊：没人陪玩慢慢涨；attention 想被理：人在电脑前却没理它时慢慢涨（约 20 分钟涨满）
  function initNeeds() {
    return { energy: 0.8, boredom: 0.2, attention: 0.15 };
  }
  function tickNeeds(needs, dt, ctx) {
    const n = Object.assign({}, needs);
    const speed = ctx.speed || 1;
    const d = dt * speed;
    if (ctx.sleeping) n.energy += d / (40 * 60);
    else n.energy -= (d / ((ctx.active ? 50 : 90) * 60)) * (ctx.night ? 1.6 : 1) * (ctx.drainMul || 1);   // drainMul：活泼的累得快（养成里的特质）
    if (ctx.playing) n.boredom -= d / 40;
    else if (!ctx.sleeping) n.boredom += d / (6 * 60);
    if (ctx.interacted) n.attention -= d / 8;
    else if (ctx.userPresent && !ctx.sleeping) n.attention += d / (20 * 60) * (ctx.attentionMul || 1);   // 人在却没理它：大约 20 分钟攒满（以前 5 分钟，没人理时一两分钟就来找一次）
    else n.attention -= d / (20 * 60);
    n.energy = clamp(n.energy, 0, 1);
    n.boredom = clamp(n.boredom, 0, 1);
    n.attention = clamp(n.attention, 0, 1);
    return n;
  }

  // ---------- 自由活动：下一个姿势 ----------
  const BASE_NEXT = {
    walk: { sniff: 3, sit: 2, idle: 2, bow: 1, lie: 1 },
    sniff: { walk: 3, sit: 1, idle: 1 },
    idle: { walk: 3, sit: 2, lie: 1, sniff: 1 },
    sit: { lie: 2, walk: 2, idle: 1 },
    lie: { sleep: 2, sit: 1, walk: 1 },
    bow: { walk: 2, idle: 1 },
    seek: { sit: 2, lie: 1, idle: 1 },
    greet: { idle: 2, walk: 1, bow: 1 },
    sleep: { idle: 1 }
  };
  function nextActionWeights(cur, needs, ctx) {
    const w = Object.assign({}, BASE_NEXT[cur] || BASE_NEXT.idle);
    const tired = 1 - needs.energy;
    // 累了更想趴、想睡；晚上更明显
    w.lie = (w.lie || 0) + tired * 3;
    w.sleep = (w.sleep || 0) + (cur === 'lie' ? tired * 4 : 0) * (ctx.night ? 1.8 : 1);   // 只从趴着犯困睡过去，不会坐着、站着直接睡
    if (needs.energy > 0.6) w.sleep = (w.sleep || 0) * 0.2;
    // 无聊了想玩：邀玩要有个玩伴，人不在时多半自己溜达、闻闻；刚睡醒还迷糊（ctx.drowsy）也不想玩
    w.bow = ((w.bow || 0) + needs.boredom * 3 * needs.energy) * (ctx.userPresent ? 1 : 0.15) * Math.max(0, 1 - 2 * (ctx.drowsy || 0));
    w.walk = (w.walk || 0) + needs.boredom * 1.5 * needs.energy;
    w.sniff = (w.sniff || 0) + needs.boredom * needs.energy;
    // 人在却没人理：去鼠标那儿坐着看你
    // 刚找过你、你没空理它（seekCooldown）：死心一阵，先不来了
    if (ctx.userPresent && !ctx.seekCooldown && needs.attention > 0.45) w.seek = needs.attention * 6;
    // 特质、性格（养成）：活泼的多走、慵懒的多趴、好奇的多闻、黏人的多来找你
    if (ctx.mul) for (const k of Object.keys(ctx.mul)) if (w[k] && ctx.mul[k] > 0) w[k] *= ctx.mul[k];
    delete w[cur];
    for (const k of Object.keys(w)) if (!(w[k] > 0)) delete w[k];
    return w;
  }
  function chooseNext(cur, needs, ctx, rnd) {
    const w = nextActionWeights(cur, needs, ctx);
    const keys = Object.keys(w);
    if (!keys.length) return 'idle';
    let total = 0;
    for (const k of keys) total += w[k];
    let r = (rnd || Math.random)() * total;
    for (const k of keys) {
      if ((r -= w[k]) <= 0) return k;
    }
    return keys[keys.length - 1];
  }

  // ---------- 人在不在电脑前 ----------
  const AWAY_IDLE_SEC = 300; // 键鼠 5 分钟没动算离开
  function isAway(idleSec, threshold) {
    return idleSec >= (threshold || AWAY_IDLE_SEC);
  }

  // ---------- 存档 ----------
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  function sanitizeState(s) {
    if (!s || typeof s !== 'object' || s.v !== 1 || !isFinite(s.savedAt)) return null;
    const out = {
      v: 1,
      savedAt: s.savedAt,
      x: clamp(num(s.x, 0.3), 0, 1),
      facing: s.facing === -1 ? -1 : 1,
      belly: clamp(num(s.belly, 0.5), 0, 1),
      food: clamp(num(s.food, 0), 0, 1),
      needs: initNeeds(),
      notes: Array.isArray(s.notes) ? s.notes.filter(n => n && typeof n.text === 'string').slice(-20)
        .map(n => ({ text: cleanNote(n.text), at: num(n.at, 0), unread: n.unread === true,
          // 合养：谁写的、服务器上的纸条 id（托盘里看了再报已读）
          ...(typeof n.from === 'string' && n.from.trim() ? { from: Array.from(n.from.trim()).slice(0, 12).join('') } : {}),
          ...(typeof n.noteId === 'string' && /^[0-9a-f-]{36}$/.test(n.noteId) ? { noteId: n.noteId } : {}) })) : [],
      groundNote: s.groundNote && typeof s.groundNote.text === 'string' ? { text: cleanNote(s.groundNote.text), x: clamp(num(s.groundNote.x, 0.5), 0, 1) } : null,
      // 碗被你摆在哪（占屏幕宽度的比例）；没摆过就是 null，用默认位置
      bowl: typeof s.bowl === 'number' && isFinite(s.bowl) ? clamp(s.bowl, 0, 1) : null,
      // 养成（特质种子、性格、胖瘦、发现了哪些特质）：页面用 grow.js 细查，这里只防太大
      grow: s.grow && typeof s.grow === 'object' && JSON.stringify(s.grow).length < 4000 ? s.grow : null
    };
    if (s.needs && typeof s.needs === 'object') {
      out.needs = {
        energy: clamp(num(s.needs.energy, 0.8), 0, 1),
        boredom: clamp(num(s.needs.boredom, 0.2), 0, 1),
        attention: clamp(num(s.needs.attention, 0.15), 0, 1)
      };
    }
    return out;
  }
  // 程序关着的这段时间：照样消化（按醒着睡着各一半估），精力回满一些，想念涨一些
  function settleAway(state, nowMs, speed) {
    const s = Object.assign({}, state);
    const away = Math.max(0, (nowMs - s.savedAt) / 1000) * (speed || 1);
    s.belly = clamp(s.belly - away * digestRate(false) * 0.75, 0, 1);
    s.needs = Object.assign({}, s.needs);
    s.needs.energy = clamp(s.needs.energy + away / (2 * HOUR), 0, 1);
    s.needs.attention = clamp(s.needs.attention + Math.min(0.5, away / (6 * HOUR)), 0, 1);
    s.awaySec = away;
    return s;
  }

  // ---------- 狗有多大：按屏幕工作区高度自适应，不给用户手动调 ----------
  // 站着时从地面到头顶约占工作区高度的 13%，最小 110、最大 220 个逻辑像素。
  // 逻辑像素已经算进了系统缩放，所以 1080p@100% 和 4K@150% 上看起来差不多大。
  const PET_HEIGHT_RATIO = 0.13, PET_HEIGHT_MIN = 110, PET_HEIGHT_MAX = 220;
  function petHeightFor(workAreaHeight) {
    const h = typeof workAreaHeight === 'number' && isFinite(workAreaHeight) ? workAreaHeight : 1000;
    return clamp(h * PET_HEIGHT_RATIO, PET_HEIGHT_MIN, PET_HEIGHT_MAX);
  }

  // ---------- 全屏时躲起来（Windows） ----------
  // SHQueryUserNotificationState 的返回值：2 有全屏程序在前台，3 全屏 D3D（游戏），4 演示模式（放 PPT）
  function shouldHideFor(quns) {
    return quns === 2 || quns === 3 || quns === 4;
  }
  // 前台窗口是不是盖住了整块屏幕（含任务栏），容差几个像素
  function coversMonitor(win, mon, tol) {
    if (!win || !mon) return false;
    const t = tol == null ? 2 : tol;
    return win.left <= mon.left + t && win.top <= mon.top + t && win.right >= mon.right - t && win.bottom >= mon.bottom - t;
  }

  // ---------- 纸条 ----------
  const NOTE_MAX = 120;
  function cleanNote(text) {
    if (typeof text !== 'string') return '';
    const t = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return Array.from(t).slice(0, NOTE_MAX).join('');
  }

  return {
    clamp, HOUR, DIGEST_FULL_HOURS, digestRate, hungerStage,
    initNeeds, tickNeeds, BASE_NEXT, nextActionWeights, chooseNext,
    AWAY_IDLE_SEC, isAway, sanitizeState, settleAway, NOTE_MAX, cleanNote,
    petHeightFor, shouldHideFor, coversMonitor
  };
});
