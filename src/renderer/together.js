// "一起养"窗口：越简单越好。
// 没一起养时：邀请朋友一起养 / 输入邀请码，两个按钮。输了码以后：第一次来点"加入"；以前就在组里、换了电脑的，从名单里认自己。
// 一起养以后：它在谁那儿（不在就能叫它回来、看看它）、要你点头的事（新人加入、新电脑认领、请人离开）、谁在电脑前、邀请码。
// 名字选填，点"你"起名。不常用的（换邀请码、退出、请人离开）收在小字链接里，点了还要再确认一次。
const main = document.getElementById('main');
const api = window.togetherApi;
let v = { mode: 'starting' }, busy = false, err = '', entering = false, naming = false, copied = false;
let peeked = null, codeInput = '', claiming = false, confirm = null;   // confirm: { kind:'leave'|'kick'|'rotate', id, name }

const el = (tag, props, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, val] of Object.entries(props || {})) {
    if (val == null || val === false) continue;
    if (k === 'class') e.className = val; else if (k.startsWith('on')) e.addEventListener(k.slice(2), val); else e.setAttribute(k, val === true ? '' : val);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
};
async function act(fn) {
  if (busy) return;
  busy = true; err = ''; render();
  try { const r = await fn(); if (r && !r.ok) err = r.error || '没成功，再试一次'; return r; }
  catch { err = '没成功，再试一次'; }
  finally { busy = false; render(); }
}
const errLine = () => el('div', { class: 'err', role: 'alert' }, err);
const others = () => (v.members || []).filter(m => !m.me && m.status === 'active');
const nameOf = m => m.nickname || 'TA';
const btn = (label, cls, onclick, extra) => el('button', { type: 'button', class: cls, disabled: busy, onclick, ...(extra || {}) }, label);
const row = (...kids) => el('div', { class: 'row2' }, ...kids);
const say = (text, size) => el('span', { class: 'big', style: size ? `font-size:${size}px` : null }, text);

function renderNone() {
  if (!entering) {
    main.append(el('div', { class: 'col' },
      btn('邀请朋友一起养', 'go wide', () => act(api.create)),
      btn('输入邀请码', 'ghost wide', () => { entering = true; err = ''; peeked = null; render(); main.querySelector('input').focus(); })),
      errLine());
    return;
  }
  // 输了码、看过组里有谁：第一次来的直接加入；换了电脑的从名单里认自己
  if (peeked) {
    const join = () => act(() => api.join(codeInput));
    main.append(el('div', { class: 'col' }, btn('第一次来，加入', 'go wide', join)));
    if (!claiming) {
      main.append(el('div', null, el('button', { type: 'button', class: 'link', onclick: () => { claiming = true; render(); } }, '以前就在这个组里，换了电脑？')));
    } else {
      const list = el('div', { class: 'row2' }, el('span', { class: 'big', style: 'font-size:17px' }, '我是：'));
      peeked.forEach((m, i) => {
        const unnamed = peeked.filter(x => !x.nickname);
        const label = m.nickname || (unnamed.length > 1 ? `TA（第 ${unnamed.indexOf(m) + 1} 位）` : 'TA');
        list.append(btn(label, 'ghost small', () => act(() => api.claim(codeInput, m.id))));
      });
      main.append(list);
    }
    main.append(errLine(), el('div', null, el('button', { type: 'button', class: 'link', onclick: () => { peeked = null; claiming = false; err = ''; render(); } }, '返回')));
    return;
  }
  const code = el('input', { class: 'code', maxlength: '20', placeholder: 'ABCD-EFGH-JKMN', 'aria-label': '邀请码', value: codeInput,
    oninput: e => { codeInput = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') next(); } });
  const next = () => act(async () => {
    codeInput = code.value;
    const r = await api.peek(codeInput);
    if (r && r.ok) { peeked = r.members || []; claiming = false; if (!peeked.length) return api.join(codeInput); }
    return r;
  });
  main.append(
    row(code, btn('加入', 'go', next)),
    errLine(),
    el('div', null, el('button', { type: 'button', class: 'link', onclick: () => { entering = false; err = ''; render(); } }, '返回')));
}

// 要你点头的事：新人加入、新电脑说自己是谁、请某人离开
function renderAsks() {
  for (const p of v.pending || []) {
    main.append(row(say(p.nickname ? `${p.nickname} 想一起养` : '有人想一起养', 18),
      btn('同意', 'go small', () => act(() => api.approve(p.id, true))),
      btn('不同意', 'ghost small', () => act(() => api.approve(p.id, false)))));
  }
  for (const c of v.claims || []) {
    // 别人的新电脑：要组里除了 TA 以外的人都同意（或者 TA 自己在别的电脑上点"是我"）
    if (c.voted) { main.append(row(say(`有台新电脑说自己是 ${c.name}：你同意了，等其他人`, 16))); continue; }
    main.append(row(say(c.mine ? '有台新电脑说它是你' : `有台新电脑说自己是 ${c.name}`, 18),
      btn(c.mine ? '是我' : '同意', 'go small', () => act(() => api.approveDevice(c.user, c.member, true))),
      btn(c.mine ? '不是' : '不同意', 'ghost small', () => act(() => api.approveDevice(c.user, c.member, false)))));
  }
  for (const k of v.kicks || []) {
    if (k.voted) { main.append(row(say(`请 ${k.name} 离开：你同意了，等其他人（${k.yes}/${k.need}）`, 16))); continue; }
    main.append(row(say(`提议请 ${k.name} 离开（${k.yes}/${k.need}）`, 17),
      btn('同意', 'go small', () => act(() => api.kick(k.target, true))),
      btn('不同意', 'ghost small', () => act(() => api.kick(k.target, false)))));
  }
}

// 不常用的操作点了以后先问一句
function renderConfirm() {
  const c = confirm;
  const text = { leave: '退出以后它就不来你这儿了，确定？', rotate: '换个新的邀请码？旧的马上作废，已经在组里的人不受影响', kick: `请 ${c.name} 离开？其他人都同意了才算` }[c.kind];
  const go = { leave: () => api.leave(), rotate: () => api.rotate(), kick: () => api.kick(c.id, true) }[c.kind];
  main.append(say(text, 18), row(
    btn({ leave: '退出', rotate: '换', kick: '提议' }[c.kind], 'go small', () => act(async () => { const r = await go(); confirm = null; return r; })),
    btn('算了', 'ghost small', () => { confirm = null; render(); })), errLine());
}

function render() {
  main.textContent = '';
  const m = v.mode;
  if (m === 'off' || m === 'starting') { main.append(el('div', { class: 'big' }, '正在连接……')); return; }
  if (m === 'offline') { main.append(el('div', { class: 'big' }, '连不上'), el('div', { class: 'err' }, '等网络好了它会自己连上')); return; }
  if (m === 'none') { renderNone(); return; }
  if (m === 'pending') {
    main.append(el('div', { class: 'big' }, v.pendingKind === 'claim' ? '等你原来那台电脑点"是我"，或者组里其他人都同意……' : '等 TA 同意……'), errLine());
    return;
  }
  if (confirm) { renderConfirm(); return; }

  // 一起养着：它在哪
  const host = v.traveling ? '它在路上……' : v.here ? '它在你这儿' : v.onMyOther ? '它在你另一台电脑上' : `它在 ${v.host ? v.host.nickname : 'TA'} 那儿`;
  const where = row(say(host));
  if (v.onMyOther && !v.traveling) where.append(btn('叫它过来', 'go small', () => act(api.call)));
  else if (!v.here && !v.traveling) {
    const why = { cooldown: '刚叫过，过一会儿再叫', 'just-arrived': '它刚到那边，让它待一会儿' }[v.callWhy] || '';
    where.append(btn('看看它', 'ghost small', () => api.watch()),
      el('button', { type: 'button', class: 'go small', disabled: !v.canCall || busy, title: why || null, onclick: () => act(api.call) }, '叫它回来'));
  }
  main.append(where);
  if (!v.here && !v.onMyOther && !v.traveling && (v.doing || v.kept)) main.append(el('div', { class: 'big', style: 'font-size:17px;color:var(--ink-soft)' }, [v.doing, v.kept ? 'TA 想再和它玩一会儿' : ''].filter(Boolean).join('。')));

  renderAsks();

  // 谁在电脑前；点"你"可以给自己起个名字（选填）；三个人以上时，名字旁边能提议请人离开
  const me = (v.members || []).find(x => x.me);
  const people = el('div', { class: 'people' });
  if (me) {
    if (naming) {
      const inp = el('input', { maxlength: '12', placeholder: '起个名字', value: me.nickname || '', 'aria-label': '你的名字', style: 'width:9em',
        onkeydown: e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { naming = false; render(); } } });
      const save = () => act(async () => { const r = await api.rename(inp.value); if (r && r.ok) naming = false; return r; });
      people.append(el('span', { class: 'who' }, el('span', { class: 'dot on' }), inp, el('button', { type: 'button', class: 'go small', onclick: save }, '好')));
      setTimeout(() => inp.focus(), 0);
    } else {
      people.append(el('span', { class: 'who' }, el('span', { class: 'dot' + (me.present ? ' on' : '') }),
        el('button', { type: 'button', class: 'me', title: '点一下起个名字（不起也行）', onclick: () => { naming = true; render(); } }, me.nickname || '你')));
    }
  }
  const kicking = new Set((v.kicks || []).map(k => k.target));
  for (const o of others()) {
    const who = el('span', { class: 'who', title: o.present ? '在电脑前' : '不在电脑前' }, el('span', { class: 'dot' + (o.present ? ' on' : '') }), nameOf(o));
    if (v.canKick && !kicking.has(o.id)) who.append(el('button', { type: 'button', class: 'link', title: `提议请 ${nameOf(o)} 离开`, onclick: () => { confirm = { kind: 'kick', id: o.id, name: nameOf(o) }; render(); } }, '请离开'));
    people.append(who);
  }
  if (others().length) main.append(people);
  main.append(errLine());

  // 邀请码（组里还没满 4 个人时显示）；最下面一行：换个邀请码、退出
  const count = (v.members || []).filter(x => x.status === 'active' || x.status === 'pending').length;
  if (!v.code && count < 4) {
    // 请人离开以后旧码作废了、新码还没换上（比如刚才那台没连上网）：给个按钮换一个
    main.append(el('div', { class: 'code-line' }, '邀请码作废了', btn('换一个', 'ghost small', () => act(api.rotate))));
  }
  if (v.code && count < 4) {
    main.append(el('div', { class: 'code-line' }, '邀请码', el('b', null, v.code),
      el('button', { type: 'button', class: 'ghost small', onclick: () => { api.copy(v.code); copied = true; render(); setTimeout(() => { copied = false; render(); }, 1500); } }, copied ? '复制好了' : '复制')));
  }
  main.append(el('div', { class: 'row2', style: 'justify-content:flex-end;gap:14px;padding-right:26px' },   // 右下角留给信纸上的小爪印
    el('button', { type: 'button', class: 'link', onclick: () => { confirm = { kind: 'rotate' }; render(); } }, '换个邀请码'),
    el('button', { type: 'button', class: 'link', onclick: () => { confirm = { kind: 'leave' }; render(); } }, '退出这个组')));
}

document.getElementById('close').addEventListener('click', () => api.close());
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !naming) { if (confirm) { confirm = null; render(); } else api.close(); } });
// 正在输入（邀请码、名字）时别重画，免得打了一半的字没了；状态真变了（比如审批通过）才重画
api.onView(nv => { const changed = nv && nv.mode !== v.mode; v = nv || v; if (changed) { entering = false; peeked = null; claiming = false; } const typing = document.activeElement && document.activeElement.tagName === 'INPUT'; if (!busy && (!typing || changed)) render(); });
api.view().then(nv => { v = nv || v; render(); });
render();
