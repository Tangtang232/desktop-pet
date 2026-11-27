// 合养的规则（不联网、不碰画面，主进程和测试都用）：
// 狗下一步去谁那儿、什么时候走；心动值怎么涨落；纸条寄给谁（@昵称）；宠物码怎么生成和校验。
// 时间单位：毫秒（和服务器的时间戳一致）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetVisit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const MIN = 60 * 1000, HOUR = 60 * MIN;

  // 人在电脑前：最近 90 秒内报过"在"（每台电脑人在时 30 秒报一次）
  const PRESENT_MS = 90 * 1000;
  // 狗所在那台电脑 3 分钟没动静（关机、断网、死机）：别的在线成员可以把它接走
  const STALE_HOST_MS = 3 * MIN;
  // 到了一个人那儿至少待这么久，才会自己走（有纸条要送、主人走开了例外）
  const MIN_STAY_MS = 10 * MIN;
  // 主人走开了（键鼠 5 分钟没动）、另一个人在：再等 2 分钟就过去
  const AWAY_LEAVE_MS = 2 * MIN;
  // 呼唤的冷却
  const CALL_COOLDOWN_MS = 10 * MIN;
  // 从一个桌面走到另一个桌面路上花的时间（走出屏幕到从对方屏幕边上进来）
  const TRAVEL_MS = 6 * 1000;

  const present = (m, now) => !!m && m.status === 'active' && m.activeAt != null && now - m.activeAt <= PRESENT_MS;

  // 一个人几台电脑：狗在我另一台上，我这台正在用（1 分钟内动过键鼠），
  // 那台已经报了"人不在"超过 90 秒、或者 3 分钟没动静：把它接到这台来。那台正有人用时不抢
  function shouldFollow({ now, idleSec, hostDevice }) {
    if (idleSec == null || idleSec > 60) return false;
    if (!hostDevice) return true;
    const idle = hostDevice.activeAt == null || now - hostDevice.activeAt > PRESENT_MS;
    const stale = hostDevice.seenAt == null || now - hostDevice.seenAt > STALE_HOST_MS;
    return idle || stale;
  }
  // 它在别人那儿干嘛（给"它在小明那儿"后面跟一句）
  const DOING = {
    sleep: '在睡觉', eat: '在吃饭', walk: '在溜达', sniff: '在闻来闻去', sit: '坐着发呆', lie: '趴着休息', idle: '站着东张西望',
    bow: '在找人玩', greet: '在迎人', held: '被拎着玩', courier: '在送纸条', stash: '在收纸条', hungry: '饿了，在碗边等',
    sad: '有点委屈', seek: '在找人', wait: '在等人理它', bringBowl: '叼着碗找吃的', leaving: '正要出门'
  };
  const doingText = act => DOING[act] || '';
  // 想念值：多久没见到它了，4 小时算满一份，最多 1.5 份
  function missing(lastWith, now) {
    if (lastWith == null) return 1.5;
    return clamp((now - lastWith) / (4 * HOUR), 0, 1.5);
  }
  // 每分钟想走的概率：对方越想它、对方心动值越高、这边心动值越低，越想走。
  // 两边都是 0.3、没想念时（加上最短停留）平均二十来分钟串一次门；这边心动值满、那边 0.3 时能待一个小时左右
  function leaveHazard(meHeart, other, now) {
    return 0.05 * (1 + missing(other.lastWith, now)) * Math.pow((0.5 + other.heart) / (0.5 + meHeart), 1.5);
  }

  // 狗所在那台电脑每分钟问一次：要不要走、去谁那儿。返回 { to, reason, noteId } 或 null
  // s: { now, me, hostSince, meAway(主人键鼠 5 分钟没动), meAwaySince, members:[{id,status,heart,lastWith,activeAt}],
  //      notes:[{id,from,to,deliveredAt}], dtMs(离上次问过了多久) }
  function decide(s, rnd) {
    const r = rnd || Math.random;
    const now = s.now, me = s.members.find(m => m.id === s.me);
    if (!me) return null;
    const others = s.members.filter(m => m.id !== s.me && present(m, now));
    if (!others.length) return null;
    const stayed = now - (s.hostSince || now);
    const pending = (s.notes || []).filter(n => !n.deliveredAt);
    // 1) 我这儿有纸条等着送、收件人在电脑前：叼着马上去（最早写的那张先送）
    const mine = pending.filter(n => n.from === s.me && others.some(o => o.id === n.to)).sort((a, b) => a.createdAt - b.createdAt);
    if (mine.length) return { to: mine[0].to, reason: 'note', noteId: mine[0].id };
    // 2) 别人那儿有纸条等着它去拿：回去拿（待满 2 分钟就走，比平时快）
    const fetch = pending.filter(n => n.from !== s.me && others.some(o => o.id === n.from));
    if (fetch.length && stayed >= 2 * MIN && r() < 1 - Math.pow(1 - 0.3, (s.dtMs || MIN) / MIN)) return { to: fetch[0].from, reason: 'fetch', noteId: null };
    // 3) 主人走开了、另一个人在：等一会儿就过去找在的那个人（心动值高的优先）
    if (s.meAway && now - (s.meAwaySince || now) >= AWAY_LEAVE_MS) {
      const best = others.slice().sort((a, b) => score(b, now) - score(a, now))[0];
      return { to: best.id, reason: 'lonely', noteId: null };
    }
    // 4) 平时：待够最短时间以后，按想念值、心动值随机串门
    if (stayed < MIN_STAY_MS) return null;
    const minutes = (s.dtMs || MIN) / MIN;
    for (const o of others.slice().sort((a, b) => score(b, now) - score(a, now))) {
      const h = leaveHazard(me.heart, o, now);
      if (r() < 1 - Math.pow(1 - clamp(h, 0, 1), minutes)) return { to: o.id, reason: 'visit', noteId: null };
    }
    return null;
  }
  const score = (m, now) => (0.5 + m.heart) * (1 + missing(m.lastWith, now));

  // 狗所在那台电脑没动静了：在线的成员把它接过来（谁在电脑前谁接；几个人都在时心动值高的接）
  function shouldReclaim(s) {
    const now = s.now, me = s.members.find(m => m.id === s.me);
    if (!present(me, now) || s.host === s.me) return false;
    if (s.travel && now - s.travel.start < STALE_HOST_MS) return false;
    if (s.hostSeenAt != null && now - s.hostSeenAt < STALE_HOST_MS) return false;
    const rivals = s.members.filter(m => m.id !== s.host && present(m, now));
    rivals.sort((a, b) => score(b, now) - score(a, now) || (a.id < b.id ? -1 : 1));
    return rivals.length > 0 && rivals[0].id === s.me;
  }

  // 呼唤它回来：冷却 10 分钟；它刚到别人那儿不满 5 分钟不走（对方不在电脑前、或那台没动静了除外）
  function canCall(s) {
    const now = s.now;
    if (s.host === s.me) return { ok: false, why: 'here' };
    if (s.calledAt != null && now - s.calledAt < CALL_COOLDOWN_MS) return { ok: false, why: 'cooldown', wait: CALL_COOLDOWN_MS - (now - s.calledAt) };
    const host = s.members.find(m => m.id === s.host);
    const hostStale = s.hostSeenAt == null || now - s.hostSeenAt >= STALE_HOST_MS;
    if (!hostStale && present(host, now) && now - (s.hostSince || 0) < 5 * MIN) return { ok: false, why: 'just-arrived', wait: 5 * MIN - (now - s.hostSince) };
    return { ok: true };
  }

  // ---------- 心动值：狗在你那儿时你做的事 ----------
  // 每天最多涨 0.15，慢慢回落到 0.3（一天回 0.02），夹在 0 到 1
  const HEART_GAIN = { pet: 0.02, feed: 0.03, answer: 0.03, noteWrite: 0.02, noteRead: 0.01, play: 0.02, struggle: -0.01 };
  const HEART_DAILY_CAP = 0.15, HEART_BASE = 0.3, HEART_DRIFT_PER_DAY = 0.02;
  // h: { heart, gainedToday, day }；day 是本地日期字符串，跨天时当天累计清零
  function heartAfter(h, kind, day) {
    const d = HEART_GAIN[kind];
    if (d == null) return h;
    const g = h.day === day ? h.gainedToday : 0;
    const add = d > 0 ? Math.max(0, Math.min(d, HEART_DAILY_CAP - g)) : d;
    return { heart: clamp(h.heart + add, 0, 1), gainedToday: g + Math.max(0, add), day };
  }
  function heartDrift(heart, ms) {
    const step = HEART_DRIFT_PER_DAY * ms / (24 * HOUR);
    return heart > HEART_BASE ? Math.max(HEART_BASE, heart - step) : Math.min(HEART_BASE, heart + step);
  }

  // ---------- 纸条寄给谁 ----------
  // 组里只有两个人时默认寄给另一个人；人多时要在纸条里写 @昵称（写在哪儿都行，取第一个能对上的）。
  // 返回 { to, text, error }：text 是去掉 @昵称 以后的正文
  function pickRecipient(text, members, me) {
    const others = members.filter(m => m.id !== me && m.status === 'active');
    if (!others.length) return { to: null, text, error: 'alone' };
    const byLen = others.filter(o => o.nickname).sort((a, b) => b.nickname.length - a.nickname.length);
    const re = /[@＠]/g;
    let m;
    while ((m = re.exec(text))) {
      const rest = text.slice(m.index + 1);
      const hit = byLen.find(o => rest.startsWith(o.nickname));
      if (hit) {
        const body = (text.slice(0, m.index) + rest.slice(hit.nickname.length)).replace(/^[\s,，:：]+/, '').trim();
        return { to: hit.id, text: body || text.trim(), error: null };
      }
    }
    if (others.length === 1) return { to: others[0].id, text: text.trim(), error: null };
    return { to: null, text, error: 'who' };
  }

  // ---------- 宠物码 ----------
  // 12 位，去掉容易看错的 0 O 1 I L，按 4 位一组显示：ABCD-EFGH-JKMN。约 59 位熵，猜不到
  const CODE_ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  function makeCode(randomBytes) {
    const b = randomBytes(12);
    let s = '';
    for (let i = 0; i < 12; i++) s += CODE_ABC[b[i] % CODE_ABC.length];
    return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8);
  }
  // 用户输入的码：去空格、横线，转大写，o→0 这类看错的字认不出来就算无效
  function normCode(input) {
    if (typeof input !== 'string') return null;
    const s = input.toUpperCase().replace(/[\s\-_－—]/g, '');
    if (s.length !== 12) return null;
    for (const ch of s) if (!CODE_ABC.includes(ch)) return null;
    return s;
  }
  const cleanNickname = n => (typeof n === 'string' ? Array.from(n.replace(/[\u0000-\u001F\u007F@＠]/g, '').trim()).slice(0, 12).join('') : '');

  return {
    PRESENT_MS, STALE_HOST_MS, MIN_STAY_MS, AWAY_LEAVE_MS, CALL_COOLDOWN_MS, TRAVEL_MS,
    present, missing, leaveHazard, decide, shouldReclaim, canCall, shouldFollow, doingText,
    HEART_GAIN, HEART_DAILY_CAP, HEART_BASE, heartAfter, heartDrift,
    pickRecipient, CODE_ABC, makeCode, normCode, cleanNickname
  };
});
