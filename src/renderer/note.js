// 写纸条窗口：输入、计数、送出、取消。
const form = document.getElementById('form');
const text = document.getElementById('text');
const count = document.getElementById('count');
const sendBtn = document.getElementById('send');

function refresh() {
  const n = Array.from(text.value).length;
  count.textContent = `${n} / 120`;
  sendBtn.disabled = text.value.trim().length === 0;
}
text.addEventListener('input', refresh);
text.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
  if (e.key === 'Escape') window.noteApi.cancel();
});
form.addEventListener('submit', e => {
  e.preventDefault();
  if (text.value.trim()) window.noteApi.send(text.value);
});
document.getElementById('cancel').addEventListener('click', () => window.noteApi.cancel());
refresh();
text.focus();
