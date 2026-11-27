// 只给 README 截图用（tools/docs/shots.mjs）：小窗口的接口换成假数据，不连主进程、不联网。
// 数据在临时文件里，路径从命令行 --doc-data= 传进来。
const fs = require('fs');
const arg = process.argv.find(a => a.startsWith('--doc-data='));
const d = arg ? JSON.parse(fs.readFileSync(arg.slice('--doc-data='.length), 'utf8')) : {};
const ok = async () => ({ ok: true });
const noop = () => {};

window.togetherApi = {
  view: async () => d.view || { mode: 'none' }, onView: noop,
  create: ok, join: ok, peek: ok, claim: ok, approveDevice: ok, rotate: ok, leave: ok, kick: ok, approve: ok, rename: ok, call: ok,
  watch: noop, copy: noop, close: noop
};
window.diaryApi = { list: async () => d.diary || [], onList: noop, close: noop };
window.watchApi = { onFrame: cb => setTimeout(() => cb(d.frame), 0), feed: ok, call: ok, close: noop };
window.noteApi = { info: async () => d.info || { mode: 'off' }, send: ok, cancel: noop };

// 写纸条窗口：先替人写好一句
window.addEventListener('DOMContentLoaded', () => {
  if (!d.text) return;
  setTimeout(() => {
    const t = document.querySelector('textarea');
    if (t) { t.value = d.text; t.dispatchEvent(new Event('input', { bubbles: true })); t.blur(); }
  }, 300);
});
