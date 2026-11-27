// "它的日记"：按天分组，最新的在最上面。只是给人看的时间线，没有按钮。
const api = window.diaryApi;
const main = document.getElementById('main');
const pad = n => String(n).padStart(2, '0');
function dayLabel(d) {
  const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, now)) return '今天';
  if (same(d, y)) return '昨天';
  return `${d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '年'}${d.getMonth() + 1}月${d.getDate()}日`;
}
function render(list) {
  main.textContent = '';
  const items = (Array.isArray(list) ? list : []).filter(e => e && typeof e.text === 'string' && Number.isFinite(e.at)).slice().reverse();
  if (!items.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = '还没写下什么。和它多待一阵子，它的事会一件件记在这儿。'; main.append(e); return; }
  let last = '';
  for (const it of items) {
    const d = new Date(it.at), label = dayLabel(d);
    if (label !== last) { last = label; const h = document.createElement('div'); h.className = 'day'; h.textContent = label; main.append(h); }
    const row = document.createElement('div'); row.className = 'entry';
    const t = document.createElement('time'); t.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const s = document.createElement('div'); s.textContent = it.text;
    row.append(t, s); main.append(row);
  }
}
document.getElementById('close').addEventListener('click', () => api.close());
document.addEventListener('keydown', e => { if (e.key === 'Escape') api.close(); });
api.onList(render);
api.list().then(render);
