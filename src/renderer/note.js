// 写纸条窗口：写字、看寄给谁、送出。合养时纸条交给服务器，由狗叼去给朋友；没合养时本机演示。
const form = document.getElementById('form');
const text = document.getElementById('text');
const count = document.getElementById('count');
const sendBtn = document.getElementById('send');
const head = document.getElementById('head');
const hint = document.getElementById('hint');
const MAX = 120;
let info = { mode: 'off' }, sending = false;

// 字数不算 @昵称
const len = () => Array.from(text.value.replace(/[@＠][^\s@＠]+\s?/g, '')).length;
function refresh() {
  const n = len();
  count.textContent = n >= MAX - 20 ? `${n} / ${MAX}` : '';   // 快写满了才提示字数
  sendBtn.disabled = sending || text.value.trim().length === 0 || n > MAX;
}
// 纸上不放说明小字，只在出错时显示一行红字
function setError(msg) { hint.textContent = msg || ''; }

// 寄给谁：两个人时直接写在抬头；人多时列出昵称，点一下插入 @昵称
function renderHead() {
  head.textContent = '';
  if (info.mode !== 'ready') { head.textContent = '写张纸条'; return; }
  const others = info.others || [];
  head.append('写给 ');
  if (others.length === 1) {
    const o = others[0];
    const to = document.createElement('span'); to.className = 'to'; to.textContent = o.nickname; head.append(to);
    return;
  }
  const chips = document.createElement('span'); chips.className = 'chips';
  for (const o of others) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (o.present ? '' : ' away'); b.textContent = '@' + o.nickname;
    b.title = o.present ? '在电脑前' : '不在电脑前，它会等对方回来再送';
    b.addEventListener('click', () => { text.value = `@${o.nickname} ` + text.value.replace(/^[@＠][^\s@＠]+\s?/, ''); text.focus(); refresh(); });
    chips.append(b);
  }
  head.append(chips);
}

text.addEventListener('input', refresh);
text.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
  if (e.key === 'Escape') window.noteApi.cancel();
});
form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!text.value.trim() || sending) return;
  sending = true; setError(''); refresh();
  let r;
  try { r = await window.noteApi.send(text.value); } catch { r = null; }
  if (!r || !r.ok) { sending = false; refresh(); setError((r && r.error) || '没送出去，再试一次'); return; }
  text.disabled = true; sendBtn.disabled = true; sendBtn.textContent = '交给它了';
});
document.getElementById('cancel').addEventListener('click', () => window.noteApi.cancel());
window.noteApi.info().then(v => { info = v || { mode: 'off' }; renderHead(); }).catch(() => renderHead());
refresh();
text.focus();
