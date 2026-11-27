// 合养：连 Supabase。管这台电脑是谁（匿名身份）、在哪个组、狗在谁那儿、纸条。
// 页面（pet.js）只管动画：这里告诉它"它要走了""它到了""它不在这儿"，它播完动画再回报过来。
// 规则（什么时候走、去谁那儿、心动值、寄给谁）在 src/shared/visit.js，这里只做联网和调度。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const V = require('../shared/visit.js');
const NC = require('./notes-crypto.js');

// 连接配置：随程序发布的 config/supabase.json（公开密钥，本来就是给客户端用的）；
// 开发时想连别的项目，放一个 config/supabase.local.json 覆盖；测试可以用环境变量指定
const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const CONFIG_FILES = [process.env.PET_SUPABASE_CONFIG, path.join(CONFIG_DIR, 'supabase.local.json'), path.join(CONFIG_DIR, 'supabase.json')].filter(Boolean);
const HEARTBEAT_MS = 30 * 1000, BRAIN_MS = 60 * 1000, STATE_UPLOAD_MS = 2 * 60 * 1000, HEART_UPLOAD_MS = 2 * 60 * 1000;
const AWAY_SEC = 300;

// 读连接配置。只接受公开密钥：误填了管理员密钥（Secret / service_role）直接拒绝，免得把它带进客户端
function loadConfig(log) {
  let c = null;
  for (const f of CONFIG_FILES) {
    try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); if (v && v.url && v.publishableKey) { c = v; break; } } catch {}
  }
  if (!c) return null;
  const key = String(c.publishableKey || '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(String(c.url || '')) || !key) return null;
  if (key.startsWith('sb_secret_')) { log('配置里填的是 Secret key，不能放进客户端，合养功能先关着'); return null; }
  if (key.split('.').length === 3) {
    try { if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'service_role') { log('配置里填的是 service_role 密钥，不能放进客户端，合养功能先关着'); return null; } } catch {}
  }
  return { url: c.url, key };
}

// 本机的小保险箱：宠物码、组钥、登录凭据用系统加密（Windows 上是 DPAPI）存进 together.json。
// 用异步的系统加密（同步接口 Electron 以后要废弃）：启动时一次解开放进内存，之后读都是现成的；写的时候先改内存、再排队加密落盘。
// 老版本用同步接口加密的（"e:" 开头），启动时解开后换成异步接口重新加密（"a:" 开头），解不开异步的就退回同步接口解一次。
// 不机密的几样（狗在不在这儿、心动值、处理过的远程喂食时间）不加密，程序一启动就能读：页面一加载就要知道狗在不在
const PLAIN_KEYS = new Set(['lastHere', 'heart', 'feedAt']);
function makeVault(file, safeStorage) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const cache = new Map();
  const unplain = v => Buffer.from(v.slice(2), 'base64').toString('utf8');
  for (const [k, v] of Object.entries(data)) if (typeof v === 'string' && v.startsWith('p:')) cache.set(k, unplain(v));
  const save = () => {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1)); fs.renameSync(file + '.tmp', file); }
    catch (err) { console.error('[together] 写入本机配置失败:', err.message); }
  };
  async function canEncrypt() { try { return !!(safeStorage && await safeStorage.isAsyncEncryptionAvailable()); } catch { return false; } }
  async function seal(k, v) {
    if (PLAIN_KEYS.has(k) || !(await canEncrypt())) return 'p:' + Buffer.from(String(v)).toString('base64');
    return 'a:' + (await safeStorage.encryptStringAsync(String(v))).toString('base64');
  }
  async function unseal(v) {
    const buf = Buffer.from(v.slice(2), 'base64');
    if (v.startsWith('a:')) { const r = await safeStorage.decryptStringAsync(buf); return { text: r.result, again: !!r.shouldReEncrypt }; }
    try { const r = await safeStorage.decryptStringAsync(buf); return { text: r.result, again: true }; }
    catch { return { text: safeStorage.decryptString(buf), again: true }; }
  }
  const ready = (async () => {
    let changed = false;
    for (const [k, v] of Object.entries(data)) {
      if (typeof v !== 'string' || v.startsWith('p:')) continue;
      try {
        const r = await unseal(v);
        cache.set(k, r.text);
        if (r.again || PLAIN_KEYS.has(k)) { data[k] = await seal(k, r.text); changed = true; }
      } catch (err) { console.error('[together] 本机保存的这一项解不开:', k); }
    }
    if (changed) save();
  })();
  let writing = Promise.resolve();
  return {
    ready,
    get: k => (cache.has(k) ? cache.get(k) : null),
    // 值没变就不重写文件（状态每次刷新都会写一遍"狗在不在这儿"，以前每 5～30 秒写一次盘）
    set(k, v) {
      if (v == null ? !cache.has(k) && !(k in data) : cache.get(k) === String(v)) return writing;
      if (v == null) cache.delete(k); else cache.set(k, String(v));
      // 写盘排队：后一次写一定落在前一次之后，文件里留下的是最后的值
      writing = writing.then(async () => { if (v == null) delete data[k]; else data[k] = await seal(k, v); save(); }).catch(() => {});
      return writing;
    },
    flush: () => writing
  };
}

const ERR_TEXT = {
  bad_code: '邀请码不对，再看看？', bad_code_format: '邀请码是 12 位，像 ABCD-EFGH-JKMN',
  too_many_tries: '试太多次了，过一小时再来', full: '这个组已经满 4 个人了', name_taken: '组里已经有人叫这个名字了，换一个吧',
  bad_nickname: '名字最多 12 个字', not_signed_in: '还没连上服务器，等一下再试', too_many: '太频繁了，歇一会儿',
  not_member: '你还不在这个组里', cooldown: '刚叫过它，过一会儿再叫', just_arrived: '它刚到那边，让它待一会儿再叫',
  alone: '还没有人和你一起养，先邀请朋友吧', who: '在纸条里写 @名字，它就知道送给谁',
  offline: '连不上服务器，检查一下网络', no_key: '解不开，邀请码可能换过了',
  two_only: '两个人的组不能请人离开，可以自己退出', kept_once: '这次已经留过它了', fed_recently: '刚有人喂过，过一会儿再喂',
  busy: '那台电脑正有人在用，等它闲下来它会自己过来', not_pending: '这条已经有人处理过了', bad_target: '找不到这个人', not_host: '它现在不在你这儿'
};
const errCode = e => {
  const m = String((e && (e.message || e.msg)) || e || '');
  for (const k of Object.keys(ERR_TEXT)) if (m.includes(k)) return k;
  return m.includes('fetch') || m.includes('network') || m.includes('Failed') ? 'offline' : m.slice(0, 120) || 'unknown';
};
const errText = code => ERR_TEXT[code] || `出了点问题：${code}`;
// 不在组里了，为什么（给托盘提示用）
const GONE_TEXT = {
  rejected: '组里有人没同意，这次没加进去', expired: '等太久没人回应，这次没加进去，可以再申请一次',
  device_rejected: '组里有人没确认，这台电脑没加进去', gone: '你已经不在那个组里了'
};

function create(opts) {
  const { userDataDir, safeStorage, toPage, onView, notify, getIdleSec, log = (...a) => console.log('[together]', ...a) } = opts;
  const diary = typeof opts.diary === 'function' ? opts.diary : () => {};
  const cfg = loadConfig(log);
  const vault = makeVault(path.join(userDataDir, 'together.json'), safeStorage);
  const listeners = new Set();
  let sb = null, channel = null, phase = cfg ? 'starting' : 'off', lastError = null, rtStatus = null;
  let myUid = null;                                         // 这台电脑的匿名身份（auth.uid()）
  let petId = null, memberId = null, code = null, groupKey = null;
  let pet = null, members = [], notes = [], devices = [], kicks = [];   // notes：解密后的缓存 {id,from,to,text,createdAt,deliveredAt,readAt}
  let pendingKind = null;                                   // 等审批：'join' 新人等同意，'claim' 新电脑等确认是本人
  let departing = null;                                     // 页面正在播"离开"的动画：{to, reason, noteId, at}
  const handledArrivals = new Set();                        // 已经播过到达动画的 travel.start
  let awaySince = null, latestState = null, stateUploadedAt = 0, heartUploadedAt = 0, heartDirty = false;
  let heart = { heart: V.HEART_BASE, gainedToday: 0, day: '', at: Date.now() };
  let lastPlayAt = 0, asking = null, lastCallAt = null;     // 留它一次：最近一次和它玩、正在问你要不要留它
  const askedCalls = new Set();
  let handledFeedAt = 0, snapTimer = null, watched = false, lastActUploaded = null;
  const timers = [];

  const now = () => Date.now();
  const ms = t => (t ? new Date(t).getTime() : null);
  const meRow = () => members.find(m => m.id === memberId) || null;
  // 名字是选填的：没起名的人，别人看到的是"TA"
  const nameOf = id => (members.find(m => m.id === id) || {}).nickname || 'TA';
  const memberForRules = m => ({ id: m.id, nickname: m.nickname, status: m.status, heart: m.heart, lastWith: ms(m.last_with), activeAt: ms(m.active_at), seenAt: ms(m.seen_at) });
  // 狗在我这个人这儿（可能在我另一台电脑上）／就在这台电脑上
  const withMe = () => !!pet && pet.host === memberId;
  const isHere = () => withMe() && (!pet.host_device || pet.host_device === myUid);
  const hostLabel = () => (!pet || !pet.host ? '' : withMe() ? '你的另一台电脑' : nameOf(pet.host));
  const activeMembers = () => members.filter(m => m.status === 'active');
  const deviceRow = uid => devices.find(d => d.user_id === uid && d.member_id === memberId) || null;

  // ---------- 给界面看的状态 ----------
  function view(forWindow) {
    const t = now(), mine = meRow();
    const ms_ = members.filter(m => m.status === 'active' || m.status === 'pending');
    const act = activeMembers();
    const out = {
      mode: phase, error: lastError ? errText(lastError) : null, pendingKind, petKey: phase === 'ready' ? petId : null,
      me: mine ? { id: mine.id, nickname: mine.nickname } : (memberId ? { id: memberId, nickname: vault.get('nickname') || '' } : null),
      members: ms_.map(m => ({ id: m.id, nickname: m.nickname || '', status: m.status, present: V.present(memberForRules(m), t), me: m.id === memberId })),
      here: isHere(), onMyOther: withMe() && !isHere(),
      host: pet && pet.host ? { id: pet.host, nickname: hostLabel() } : null,
      doing: pet && !isHere() && pet.state ? V.doingText(pet.state.act) : '',
      traveling: !!departing || !!(pet && pet.travel),
      outbox: notes.filter(n => n.from === memberId && !n.deliveredAt).map(n => ({ id: n.id, toName: nameOf(n.to) })),
      pending: members.filter(m => m.status === 'pending' && m.id !== memberId).map(m => ({ id: m.id, nickname: m.nickname || '' })),
      // 新电脑说自己是组里的某某，等人确认
      claims: devices.filter(d => d.status === 'pending' && act.some(m => m.id === d.member_id))
        .map(d => ({ user: d.user_id, member: d.member_id, name: d.member_id === memberId ? '你' : nameOf(d.member_id), mine: d.member_id === memberId })),
      // 请人离开的投票（被请的人看不到）
      kicks: [...new Set(kicks.map(k => k.target))].filter(id => id !== memberId && act.some(m => m.id === id)).map(id => ({
        target: id, name: nameOf(id), yes: kicks.filter(k => k.target === id && k.ok).length, need: act.length - 1,
        voted: kicks.some(k => k.target === id && k.voter === memberId && k.ok)
      })),
      canKick: act.length >= 3,
      kept: !!(pet && pet.call && pet.call.by === memberId && pet.call.kept && t < pet.call.until),
      canFeed: phase === 'ready' && !!pet && !withMe() && !(pet.feed && t - pet.feed.at < 10 * 60 * 1000)
    };
    if (phase === 'ready' && pet && !withMe()) {
      const c = V.canCall({ now: t, me: memberId, host: pet.host, hostSince: ms(pet.host_since), hostSeenAt: ms((members.find(m => m.id === pet.host) || {}).seen_at), calledAt: ms(pet.called_at), members: members.map(memberForRules) });
      out.canCall = c.ok; out.callWhy = c.ok ? null : c.why;
    }
    if (forWindow) out.code = code;
    return out;
  }
  function publish() {
    if (phase === 'ready' && pet) vault.set('lastHere', isHere() ? '1' : '0');
    const v = view(false);
    toPage('together', v);
    if (onView) onView(v);
    for (const fn of listeners) { try { fn(view(true)); } catch {} }
  }

  // ---------- 连接 ----------
  async function connect() {
    const { createClient } = require('@supabase/supabase-js');
    const storage = { getItem: k => vault.get('auth:' + k), setItem: (k, v) => vault.set('auth:' + k, v), removeItem: k => vault.set('auth:' + k, null) };
    sb = createClient(cfg.url, cfg.key, {
      auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } }
    });
    let { data } = await sb.auth.getSession();
    if (!data.session) {
      const r = await sb.auth.signInAnonymously();
      if (r.error) throw r.error;
      data = { session: r.data.session };
    }
    myUid = data.session && data.session.user ? data.session.user.id : null;
  }
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw error;
    return data;
  }

  let loaded = false;
  async function loadLocal() {
    if (loaded) return;
    await vault.ready;
    loaded = true;
    petId = vault.get('petId'); memberId = vault.get('memberId'); code = vault.get('code');
    groupKey = vault.get('groupKey') ? Buffer.from(vault.get('groupKey'), 'hex') : null;
    try { const h = JSON.parse(vault.get('heart') || 'null'); if (h) heart = h; } catch {}
    handledFeedAt = Number(vault.get('feedAt')) || 0;
  }
  async function start() {
    await loadLocal();
    if (phase === 'off') { publish(); return; }
    try {
      await connect();
      lastError = null;
      if (petId) await refresh(); else { phase = 'none'; publish(); }
      subscribe();
    } catch (err) {
      lastError = errCode(err); phase = 'offline'; log('连接失败:', err.message || err); publish();
      timers.push(setTimeout(start, 60 * 1000));
      return;
    }
    if (!timers.length || phase !== 'offline') {
      timers.push(setInterval(beat, HEARTBEAT_MS), setInterval(brain, BRAIN_MS));
      beat();
    }
  }

  // 从服务器把这个组的东西读一遍
  async function refresh() {
    if (!petId) { phase = 'none'; publish(); return; }
    const p = await sb.from('pets').select('*').eq('id', petId).maybeSingle();
    if (p.error) throw p.error;
    if (!p.data) {
      // 读不到宠物：还在等审批（新人等同意、新电脑等确认），或者被拒了、作废了、被请离开了、组散了
      const d = myUid ? await sb.from('devices').select('status').eq('user_id', myUid).eq('member_id', memberId).maybeSingle() : { data: null };
      const m = await sb.from('members').select('*').eq('id', memberId).maybeSingle();
      if (d.data && d.data.status === 'pending') { phase = 'pending'; pendingKind = 'claim'; members = m.data ? [m.data] : []; publish(); return; }
      if (m.data && m.data.status === 'pending') { phase = 'pending'; pendingKind = 'join'; members = [m.data]; publish(); return; }
      const why = d.data && d.data.status === 'rejected' ? 'device_rejected' : m.data && GONE_TEXT[m.data.status] ? m.data.status : 'gone';
      log('这台电脑已经不在那个组里了:', why);
      notify(GONE_TEXT[why]);
      forget(); return;
    }
    pet = p.data;
    const ms_ = await sb.from('members').select('*').eq('pet_id', petId);
    if (ms_.error) throw ms_.error;
    members = ms_.data;
    const ids = members.map(m => m.id);
    const ds = await sb.from('devices').select('user_id, member_id, status, seen_at, active_at, created_at').in('member_id', ids);
    devices = (ds.data || []).map(d => ({ ...d, activeAt: ms(d.active_at), seenAt: ms(d.seen_at) }));
    const ks = await sb.from('kick_votes').select('*').in('target', ids);
    kicks = ks.data || [];
    const ns = await sb.from('notes').select('*').eq('pet_id', petId).order('created_at', { ascending: false }).limit(60);
    if (ns.error) throw ns.error;
    notes = ns.data.map(decryptNote).filter(Boolean);
    // 邀请码：服务器上有加密的最新码就用它（别人换过码，这边也跟着变）；没有就把本机记着的补上去
    if (groupKey && pet.code_box) {
      // 解不开（请人离开以后服务器把码作废了、还没换上新的）：不再显示旧码
      const c = NC.open(groupKey, pet.code_box, 'code:' + petId) || null;
      if (c !== code) { code = c; vault.set('code', c); }
    } else if (groupKey && code && !pet.code_box) {
      rpc('set_code_box', { p_pet: petId, p_box: NC.seal(groupKey, code, 'code:' + petId) }).catch(() => {});
    }
    phase = 'ready'; pendingKind = null;
    publish();
    onPetChanged();
  }
  function forget() {
    for (const k of ['petId', 'memberId', 'code', 'groupKey', 'nickname', 'lastHere', 'feedAt']) vault.set(k, null);
    petId = memberId = code = null; groupKey = null; pet = null; members = []; notes = []; devices = []; kicks = []; phase = 'none'; pendingKind = null;
    departing = null; asking = null; stopSnapshots();
    if (channel) { sb.removeChannel(channel); channel = null; }
    publish();
  }
  function decryptNote(n) {
    const text = groupKey ? NC.open(groupKey, n.body, n.pet_id) : null;
    return { id: n.id, from: n.from_member, to: n.to_member, text: text == null ? '（这张纸条解不开）' : text, createdAt: ms(n.created_at), deliveredAt: ms(n.delivered_at), readAt: ms(n.read_at) };
  }
  let refreshTimer = null;
  const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh().catch(e => log('刷新失败:', e.message)), 800); };

  // 实时推送：狗换地方、成员变化（新人、审批、在线）、新纸条、新电脑认领、请人离开的投票
  function subscribe() {
    if (!sb || !petId) return;
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('pet-' + petId + '-' + Math.random().toString(36).slice(2, 8));
    if (phase === 'pending') {
      channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'members', filter: `id=eq.${memberId}` }, ev => {
        if (ev.new.status === 'active') { notify('大家都同意了，欢迎加入！'); diary('加入了一起养'); refresh().then(subscribe).catch(e => log(e.message)); }
        else if (ev.new.status !== 'pending') refreshSoon();
      });
      if (myUid) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `user_id=eq.${myUid}` }, ev => {
        if (ev.new && ev.new.status === 'active') { notify('确认是你了，欢迎回来！'); refresh().then(subscribe).catch(e => log(e.message)); }
        else refreshSoon();
      });
    } else {
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pets', filter: `id=eq.${petId}` }, ev => { if (ev.new && ev.new.id) { pet = ev.new; onPetChanged(); publish(); } else refreshSoon(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `pet_id=eq.${petId}` }, ev => {
          if (!ev.new || !ev.new.id) return;
          const i = members.findIndex(m => m.id === ev.new.id);
          const was = i >= 0 ? members[i] : null;
          if (i >= 0) members[i] = ev.new; else members.push(ev.new);
          if (!was && ev.new.status === 'pending') notify(`${ev.new.nickname || '有人'}想一起养，打开"一起养"点同意`);
          if (ev.new.id === memberId && ev.new.status !== 'active') { refresh().catch(() => {}); return; }
          if (was && was.status !== ev.new.status) refreshSoon();
          publish();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `pet_id=eq.${petId}` }, ev => {
          if (!ev.new || !ev.new.id) return;
          const n = decryptNote(ev.new), i = notes.findIndex(x => x.id === n.id);
          if (i >= 0) notes[i] = n; else notes.unshift(n);
          publish();
          if (ev.eventType === 'INSERT') brainSoon();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, ev => {
          if (ev.new && ev.new.status === 'pending' && members.some(m => m.id === ev.new.member_id)) {
            notify(ev.new.member_id === memberId ? '有台新电脑说它是你，打开"一起养"确认一下' : `有台新电脑说它是 ${nameOf(ev.new.member_id)}，打开"一起养"确认一下`);
          }
          refreshSoon();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'kick_votes' }, () => refreshSoon());
    }
    // 订阅生效时先补拉一次：订阅建立之前发生的变化（比如刚建组时就有人来加入）推送收不到
    channel.subscribe((status, err) => {
      rtStatus = status;
      if (status === 'SUBSCRIBED') refresh().catch(e => log('补拉失败:', e.message));
      else log('实时推送', status, err ? err.message || err : '');
    });
  }

  // ---------- 狗换地方 ----------
  function onPetChanged() {
    if (!pet || phase !== 'ready') return;
    const tr = pet.travel, t = now();
    if (isHere()) {
      if (tr && tr.to === memberId && !handledArrivals.has(tr.start)) {
        handledArrivals.add(tr.start);
        const n = tr.note ? notes.find(x => x.id === tr.note) : null;
        if (tr.reason !== 'follow') diary(n ? `${nameOf(tr.from)} 托它带来一张纸条` : tr.reason === 'leave' ? `${nameOf(tr.from)} 退出了，它搬到你这儿` : `它从 ${nameOf(tr.from)} 那儿过来了`);
        toPage('arrive', {
          fromName: tr.reason === 'follow' ? '' : nameOf(tr.from), reason: tr.reason, state: pet.state || null, startedAt: tr.start,
          note: n ? { id: n.id, text: n.text, fromName: (members.find(m => m.id === n.from) || {}).nickname || '' } : null
        });
      }
      // 远程喂食：每一次只处理一回（记在本机，重启也不会重复倒粮）；太久以前的不算
      if (pet.feed && pet.feed.at > handledFeedAt) {
        handledFeedAt = pet.feed.at; vault.set('feedAt', String(handledFeedAt));
        if (t - pet.feed.at < 10 * 60 * 1000) { toPage('remoteFeed', { fromName: nameOf(pet.feed.by) }); diary(`${nameOf(pet.feed.by)} 隔空喂了它一碗`); }
      }
      // 有人在远程看它：开始传小图；看的人走了就停
      if (pet.watch && pet.watch.until > t) startSnapshots(); else stopSnapshots();
      // 新的呼唤：马上想想要不要走（不用等到下一分钟）
      if (pet.call && pet.call.at !== lastCallAt) { lastCallAt = pet.call.at; brainSoon(); }
    } else {
      stopSnapshots();
      // 狗不在这台电脑上（被别人接走了，或者在我另一台电脑上）：页面上有狗就让它消失
      if (!departing) toPage('abroad', { hostName: hostLabel() });
    }
  }
  let brainTimer = null;
  const brainSoon = (wait = 1500) => { clearTimeout(brainTimer); brainTimer = setTimeout(brain, wait); };
  // 你在自己另一台电脑上正用着（那台 90 秒内报过"人在"）
  const activeElsewhere = t => devices.some(d => d.member_id === memberId && d.user_id !== myUid && d.status === 'active' && d.activeAt != null && t - d.activeAt <= V.PRESENT_MS);
  function rulesState() {
    const t = now();
    return {
      now: t, me: memberId, host: pet.host, hostSince: ms(pet.host_since), travel: pet.travel,
      hostSeenAt: ms((members.find(m => m.id === pet.host) || {}).seen_at),
      // 这台没人用、可你在另一台电脑上用着：不算走开（不把狗送去别人那儿），等那台把它接过去
      meAway: awaySince != null && !activeElsewhere(t), meAwaySince: awaySince,
      members: members.map(memberForRules),
      notes: notes.map(n => ({ id: n.id, from: n.from, to: n.to, createdAt: n.createdAt, deliveredAt: n.deliveredAt }))
    };
  }
  let lastBrain = 0;
  async function brain() {
    if (phase !== 'ready' || !pet || departing) return;
    const s = rulesState(), dtMs = lastBrain ? Math.min(5 * 60 * 1000, s.now - lastBrain) : BRAIN_MS;
    lastBrain = s.now;
    try {
      // 狗在我另一台电脑上：这台正在用、那台闲着，就把它接过来
      if (withMe() && !isHere()) {
        if (V.shouldFollow({ now: s.now, idleSec: getIdleSec ? getIdleSec() : 0, hostDevice: deviceRow(pet.host_device) })) {
          const row = await rpc('follow_me', { p_pet: petId });
          if (row && row.id) { pet = row; onPetChanged(); publish(); }
        }
        return;
      }
      if (isHere()) {
        if (pet.travel && pet.travel.to === memberId) return;   // 刚到，还在走进来
        // 有人呼唤：去找他（他得在电脑前）。你正在和它玩时先问你一句，可以留它一次
        const c = pet.call, caller = c && c.by !== memberId ? members.find(m => m.id === c.by) : null;
        if (caller && V.present(memberForRules(caller), s.now)) {
          if (c.kept && s.now < c.until) { brainSoon(c.until - s.now + 1000); return; }
          if (!c.kept && !askedCalls.has(c.at) && s.now - lastPlayAt < 60 * 1000 && !s.meAway) {
            askedCalls.add(c.at); asking = { at: c.at, until: s.now + 20 * 1000 };
            toPage('callAsk', { byName: nameOf(c.by) });
            brainSoon(20 * 1000 + 500); return;
          }
          if (asking && asking.at === c.at && s.now < asking.until) return;
          asking = null;
          return beginDeparture(caller.id, 'call', null);
        }
        const d = V.decide({ ...s, dtMs });
        if (d) beginDeparture(d.to, d.reason, d.noteId);
      } else if (V.shouldReclaim(s)) {
        log('它所在的那台电脑没动静了，把它接过来');
        await rpc('start_travel', { p_pet: petId, p_to: memberId, p_reason: 'reclaim', p_note: null, p_state: null });
      }
    } catch (err) { log('串门出错:', err.message || err); }
  }
  // 被呼唤时你在和它玩：页面问你"让它去 / 再玩一会儿"，这里是你的回答
  async function answerCall(keep) {
    const a = asking; asking = null;
    toPage('callAskDone', null);
    if (!keep || !a) { brainSoon(300); return { ok: true }; }
    try { await rpc('keep_pet', { p_pet: petId }); await refresh(); brainSoon(); return { ok: true }; }
    catch (err) { brainSoon(300); return { ok: false, error: errText(errCode(err)) }; }
  }
  // 让页面先播离开的动画（叼起纸条、走出屏幕），走出去了再告诉服务器
  function beginDeparture(to, reason, noteId) {
    const n = noteId ? notes.find(x => x.id === noteId) : null;
    departing = { to, reason, noteId, at: now() };
    stopSnapshots();
    toPage('depart', { toName: nameOf(to), reason, note: n ? { id: n.id, text: n.text } : null });
    publish();
    // 页面一分钟都没走出去（比如一直被拎着）：这次算了
    setTimeout(() => { if (departing && now() - departing.at >= 59000) { departing = null; toPage('departCancel', null); publish(); } }, 60000);
  }
  async function departed(state) {
    if (!departing) return;
    const d = departing;
    try {
      const row = await rpc('start_travel', { p_pet: petId, p_to: d.to, p_reason: d.reason, p_note: d.noteId, p_state: compactState(state) });
      if (row && row.id) pet = row;
      departing = null;
      if (d.reason === 'note') notify(`它叼着纸条去找 ${nameOf(d.to)} 了`);
      diary(d.reason === 'note' ? `叼着你的纸条去找 ${nameOf(d.to)}` : `去 ${nameOf(d.to)} 那儿串门了`);
      publish();
    } catch (err) {
      log('出门失败:', err.message || err);
      departing = null; lastError = errCode(err);
      toPage('departFailed', null); publish();
    }
  }
  async function arrived() {
    if (!petId || phase !== 'ready') return;
    try { await rpc('arrived', { p_pet: petId }); } catch (err) { log('报到失败:', err.message || err); }
  }
  // 换地方时带过去的：肚子、需求、心情、在干嘛，和打包的时间（对方按经过的时间补算消化）
  function compactState(s) {
    if (!s || typeof s !== 'object') return latestState ? compactState(latestState) : null;
    const pick = o => (o && typeof o === 'object' ? o : undefined);
    const g = s.grow && typeof s.grow === 'object' ? { persona: pick(s.grow.persona), weight: typeof s.grow.weight === 'number' ? s.grow.weight : undefined } : undefined;
    return { v: 1, at: now(), belly: s.belly, needs: pick(s.needs), mind: pick(s.mind), act: typeof s.act === 'string' ? s.act.slice(0, 16) : undefined, grow: g };
  }

  // ---------- 心跳：客户端开着就报；人在电脑前（键鼠 5 分钟内动过）就顺带报"在" ----------
  async function beat() {
    if (!sb || !petId || phase === 'none' || phase === 'off') return;
    const idle = getIdleSec ? getIdleSec() : 0, active = idle < AWAY_SEC;
    if (active) awaySince = null; else if (awaySince == null) awaySince = now() - (idle - AWAY_SEC) * 1000;
    try {
      await rpc('heartbeat', { p_pet: petId, p_active: active });
      if (phase === 'offline') { phase = 'ready'; lastError = null; await refresh(); subscribe(); }
      // 狗在这儿：定时把它的肚子、心情传上去（这台突然关机时，接走它的人能接着养；别人也能看到它在干嘛）
      // "在干嘛"变了也传（最多半分钟一次），别人碗上、"一起养"里看到的不会差太多
      const actChanged = latestState && latestState.act && latestState.act !== lastActUploaded && now() - stateUploadedAt > 30 * 1000;
      if (isHere() && latestState && (now() - stateUploadedAt > STATE_UPLOAD_MS || actChanged)) {
        stateUploadedAt = now(); lastActUploaded = latestState.act;
        await rpc('save_state', { p_pet: petId, p_state: compactState(latestState) });
      }
      if (heartDirty && now() - heartUploadedAt > HEART_UPLOAD_MS) uploadHeart();
      if (phase === 'pending' || phase === 'ready') await refresh();
    } catch (err) {
      const c = errCode(err);
      if (c === 'offline' && phase === 'ready') { phase = 'offline'; lastError = c; publish(); }
    }
  }

  // ---------- 心动值：狗在这儿时你做的事 ----------
  function heartEvent(kind) {
    if (!isHere()) return;
    const t = now(), day = new Date(t).toISOString().slice(0, 10);
    lastPlayAt = t;
    const drifted = { ...heart, heart: V.heartDrift(heart.heart, Math.max(0, t - (heart.at || t))) };
    const next = V.heartAfter(drifted, kind, day);
    heart = { ...next, at: t };
    vault.set('heart', JSON.stringify(heart));
    heartDirty = true;
  }
  async function uploadHeart() {
    heartUploadedAt = now(); heartDirty = false;
    try { await rpc('set_heart', { p_pet: petId, p_heart: heart.heart }); } catch (err) { heartDirty = true; }
  }

  // ---------- 远程看它：看的人每分钟续一次；狗所在那台每 4 秒传一张小图 ----------
  function startSnapshots() {
    if (snapTimer) return;
    if (!watched) { watched = true; toPage('watched', true); }
    const tick = () => {
      if (!isHere() || !pet || !pet.watch || pet.watch.until < now() || departing) { stopSnapshots(); return; }
      toPage('snapshot', null);
    };
    snapTimer = setInterval(tick, 4000); tick();
  }
  function stopSnapshots() {
    if (snapTimer) { clearInterval(snapTimer); snapTimer = null; }
    if (watched) { watched = false; toPage('watched', false); }
  }
  async function postSnapshot(img, act) {
    if (!isHere() || !groupKey || typeof img !== 'string' || !img.startsWith('data:image/png;base64,') || img.length > 250000) return;
    const body = NC.seal(groupKey, JSON.stringify({ img, act: String(act || '').slice(0, 16) }), 'snap:' + petId);
    try { await rpc('post_snapshot', { p_pet: petId, p_body: body }); } catch (err) { log('传小图失败:', err.message || err); }
  }
  async function watch(on) {
    if (phase !== 'ready' || !pet || withMe()) return { ok: false };
    try { await rpc('watch_pet', { p_pet: petId, p_on: !!on }); return { ok: true }; } catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  async function latestSnapshot() {
    if (phase !== 'ready' || !groupKey) return null;
    const r = await sb.from('snapshots').select('body, at').eq('pet_id', petId).maybeSingle();
    if (!r.data) return null;
    const j = NC.open(groupKey, r.data.body, 'snap:' + petId);
    if (!j) return null;
    try {
      const o = JSON.parse(j);
      if (typeof o.img !== 'string' || !o.img.startsWith('data:image/png;base64,')) return null;
      return { img: o.img, doing: V.doingText(o.act), at: ms(r.data.at) };
    } catch { return null; }
  }
  async function remoteFeed() {
    try { const r = await rpc('remote_feed', { p_pet: petId }); await refresh(); return { ok: true, status: r }; }
    catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }

  // ---------- 建组、加入、认领、审批、呼唤 ----------
  async function adopt(r, c, nick) {
    const key = NC.unwrapKey(r.key_wrap, c);
    if (!key) return { ok: false, error: errText('no_key') };
    petId = r.pet_id; memberId = r.member_id; groupKey = key; code = c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8);
    vault.set('petId', petId); vault.set('memberId', memberId); vault.set('code', code); vault.set('groupKey', key.toString('hex'));
    if (nick != null) vault.set('nickname', nick);
    await refresh(); subscribe();
    return { ok: true, status: r.status };
  }
  async function createPet(nickname) {
    const nick = V.cleanNickname(nickname || '');
    if (!sb) return { ok: false, error: errText('not_signed_in') };
    const c = V.makeCode(n => crypto.randomBytes(n)), key = NC.newGroupKey();
    try {
      const r = await rpc('create_pet', { p_code: c, p_key_wrap: NC.wrapKey(key, V.normCode(c)), p_nickname: nick });
      petId = r.pet_id; memberId = r.member_id; code = c; groupKey = key;
      vault.set('petId', petId); vault.set('memberId', memberId); vault.set('code', code); vault.set('groupKey', key.toString('hex')); vault.set('nickname', nick);
      await rpc('set_code_box', { p_pet: petId, p_box: NC.seal(key, c, 'code:' + petId) }).catch(() => {});
      await refresh(); subscribe();
      diary('开始和朋友一起养它');
      if (latestState) { stateUploadedAt = now(); rpc('save_state', { p_pet: petId, p_state: compactState(latestState) }).catch(() => {}); }
      return { ok: true, code: c };
    } catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  async function joinPet(input, nickname) {
    const c = V.normCode(input), nick = V.cleanNickname(nickname || '');
    if (!c) return { ok: false, error: errText('bad_code_format') };
    if (!sb) return { ok: false, error: errText('not_signed_in') };
    try { return await adopt(await rpc('join_pet', { p_code: c, p_nickname: nick }), c, nick); }
    catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  // 输了邀请码先看看组里有谁：第一次来的点"加入"；换了电脑的从名单里认自己
  async function peek(input) {
    const c = V.normCode(input);
    if (!c) return { ok: false, error: errText('bad_code_format') };
    if (!sb) return { ok: false, error: errText('not_signed_in') };
    try {
      const r = await rpc('peek_pet', { p_code: c });
      return { ok: true, members: (r.members || []).map(m => ({ id: m.id, nickname: m.nickname || '', since: m.since })) };
    } catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  async function claim(input, member) {
    const c = V.normCode(input);
    if (!c) return { ok: false, error: errText('bad_code_format') };
    if (!sb) return { ok: false, error: errText('not_signed_in') };
    try { return await adopt(await rpc('claim_member', { p_code: c, p_member: member }), c, null); }
    catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  async function approveDevice(user, member, ok) {
    try { const r = await rpc('approve_device', { p_user: user, p_member: member, p_ok: !!ok }); await refresh(); return { ok: true, status: r }; }
    catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  // 给自己起名字（选填，随时能改；留空就是"TA"）
  async function rename(nickname) {
    const nick = V.cleanNickname(nickname || '');
    try { await rpc('set_nickname', { p_pet: petId, p_nickname: nick }); vault.set('nickname', nick); await refresh(); return { ok: true }; }
    catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  async function approve(id, ok) {
    try { const r = await rpc('approve', { p_member: id, p_ok: !!ok }); await refresh(); return { ok: true, status: r }; }
    catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  async function callPet() {
    // 狗在我另一台电脑上：叫它过来（那台正有人用时它不来）
    if (withMe() && !isHere()) {
      try { const row = await rpc('follow_me', { p_pet: petId }); if (row && row.id) { pet = row; onPetChanged(); publish(); } return { ok: true, status: 'follow' }; }
      catch (err) { return { ok: false, error: errText(errCode(err)) }; }
    }
    try { const r = await rpc('call_pet', { p_pet: petId }); await refresh(); return { ok: true, status: r }; }
    catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  // 换邀请码：旧码立刻作废。组钥不变（已经进组的电脑照常用），只是换一把锁把它包起来
  async function rotateCode() {
    if (phase !== 'ready' || !groupKey) return { ok: false, error: errText('not_member') };
    const c = V.makeCode(n => crypto.randomBytes(n));
    try {
      await rpc('rotate_code', { p_pet: petId, p_code: c, p_key_wrap: NC.wrapKey(groupKey, V.normCode(c)), p_box: NC.seal(groupKey, c, 'code:' + petId) });
      code = c; vault.set('code', c); await refresh();
      return { ok: true, code: c };
    } catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  // 退出：这台（和你别的电脑）都离开这个组；狗在你这儿就交给别人，你桌面上回到单机的那只
  async function leave() {
    if (phase !== 'ready') return { ok: false, error: errText('not_member') };
    try { const r = await rpc('leave_pet', { p_pet: petId }); forget(); diary('退出了一起养'); return { ok: true, status: r }; }
    catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  // 请人离开：两个人的组不行；除了被请的人，其他人都同意才算。最后一票投下去的这台负责换邀请码，被请走的人再也进不来
  async function voteKick(target, ok) {
    try {
      const r = await rpc('vote_kick', { p_target: target, p_ok: !!ok });
      if (r === 'kicked') await rotateCode();
      await refresh();
      return { ok: true, status: r };
    } catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }

  // ---------- 纸条 ----------
  async function sendNote(raw) {
    if (phase !== 'ready' || !groupKey) return { ok: false, error: errText(phase === 'offline' ? 'offline' : 'not_member') };
    const r = V.pickRecipient(String(raw || ''), members.map(m => ({ id: m.id, nickname: m.nickname, status: m.status })), memberId);
    if (r.error) return { ok: false, error: errText(r.error) };
    const text = r.text;
    try {
      const id = await rpc('send_note', { p_pet: petId, p_to: r.to, p_body: NC.seal(groupKey, text, petId) });
      if (!notes.some(n => n.id === id)) notes.unshift({ id, from: memberId, to: r.to, text, createdAt: now(), deliveredAt: null, readAt: null });
      heartEvent('noteWrite');
      const toRow = members.find(m => m.id === r.to);
      const present = V.present(memberForRules(toRow), now());
      const how = isHere() ? (present ? 'going' : 'waitRecipient') : 'waitDog';
      publish(); brainSoon();
      return { ok: true, toName: toRow.nickname || 'TA', how, hostName: hostLabel() };
    } catch (err) { return { ok: false, error: errText(errCode(err)) }; }
  }
  async function noteRead(id) {
    heartEvent('noteRead');
    try { await rpc('read_note', { p_note: id }); } catch (err) { log('标记已读失败:', err.message || err); }
  }
  // 给写纸条窗口看：寄给谁、它会怎么送
  function noteInfo() {
    if (phase !== 'ready') return { mode: phase };
    const t = now(), others = members.filter(m => m.status === 'active' && m.id !== memberId);
    return {
      mode: 'ready', here: isHere(), hostName: hostLabel(),
      others: others.map(m => ({ id: m.id, nickname: m.nickname || 'TA', present: V.present(memberForRules(m), t) }))
    };
  }

  function stop() { for (const t of timers) { clearInterval(t); clearTimeout(t); } stopSnapshots(); if (sb && channel) sb.removeChannel(channel); }

  return {
    get enabled() { return phase !== 'off'; },
    get ready() { return phase === 'ready'; },
    start, stop, view,
    // "一起养"窗口开着时每 5 秒拉一次：刚建好组、推送还没接通的那几秒里有人来申请，也能很快看到
    onWindowView(fn) {
      listeners.add(fn);
      const t = setInterval(() => { if (sb && petId && (phase === 'ready' || phase === 'pending')) refresh().catch(() => {}); }, 5000);
      return () => { listeners.delete(fn); clearInterval(t); };
    },
    createPet, joinPet, peek, claim, approve, approveDevice, rename, callPet, rotateCode, leave, voteKick,
    sendNote, noteRead, noteInfo,
    departed, arrived, heartEvent, answerCall,
    postSnapshot, watch, latestSnapshot, remoteFeed,
    setLatestState(s) { latestState = s; },
    isHere, refresh: () => refresh().catch(e => log(e.message)),
    // 上次关程序时狗在不在这儿（启动时先别让它露面，等连上服务器再说）。这一项不加密，启动时马上能读
    startAbroad: () => vault.get('lastHere') === '0',
    // 测试用：立刻跑一次串门判断、报一次平安、看连接状态
    _brain: brain, _beat: beat,
    _debug: () => ({ phase, rtStatus, channel: channel && channel.state, members: members.length, notes: notes.length, host: pet && pet.host, hostDevice: pet && pet.host_device, me: memberId, uid: myUid, devices: devices.length, kicks: kicks.length })
  };
}

module.exports = { create, loadConfig, ERR_TEXT, _makeVault: makeVault };
