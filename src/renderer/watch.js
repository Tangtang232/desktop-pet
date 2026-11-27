// "看看它"窗口：狗在别人那儿时远程看它（几秒一张的小图，只有狗，没有对方的桌面）、喂一碗、叫它回来。
const api = window.watchApi;
const $ = id => document.getElementById(id);
const where = $('where'), view = $('view'), err = $('err'), feed = $('feed'), call = $('call');
let f = null, busy = false, lastImg = null;

function hint(text) { view.textContent = ''; const d = document.createElement('div'); d.className = 'hint'; d.textContent = text; view.append(d); lastImg = null; }
function render() {
  if (!f) return;
  if (f.here) { where.textContent = '它回到你这儿了'; hint('去桌面上看它吧'); feed.hidden = call.hidden = true; return; }
  if (f.onMyOther) { where.textContent = '它在你另一台电脑上'; hint('那台闲下来，它会自己过来'); feed.hidden = call.hidden = true; return; }
  feed.hidden = call.hidden = false;
  if (f.paused) { where.textContent = `它在 ${f.hostName || 'TA'} 那儿`; hint('看了好一会儿了，先停一停。点这里接着看'); }
  else if (f.traveling) { where.textContent = '它在路上……'; hint('一会儿就到'); }
  else {
    where.textContent = `它在 ${f.hostName || 'TA'} 那儿` + (f.doing ? `，${f.doing}` : '') + (f.kept ? '。TA 想再和它玩一会儿' : '');
    if (f.img) {
      if (f.img !== lastImg) {
        const img = new Image(); img.alt = '它现在的样子'; img.src = f.img;
        view.textContent = ''; view.append(img); lastImg = f.img;
      }
    } else hint(f.waiting ? '等它那边传画面过来……' : '它那边的电脑好像睡着了，暂时看不到');
  }
  feed.disabled = busy || !f.canFeed;
  feed.title = f.canFeed ? '' : '刚有人喂过，过一会儿再喂';
  call.disabled = busy || !f.canCall;
  call.title = { cooldown: '刚叫过，过一会儿再叫', 'just-arrived': '它刚到那边，让它待一会儿' }[f.callWhy] || '';
}
async function act(fn, okText) {
  if (busy) return;
  busy = true; err.textContent = ''; render();
  try { const r = await fn(); err.textContent = r && r.ok ? okText : (r && r.error) || '没成功，再试一次'; }
  catch { err.textContent = '没成功，再试一次'; }
  finally { busy = false; render(); }
}
feed.addEventListener('click', () => act(api.feed, '喂好了，它那边的碗满了'));
call.addEventListener('click', () => act(api.call, '叫了，它马上就来'));
$('close').addEventListener('click', () => api.close());
view.addEventListener('click', () => { if (f && f.paused) api.resume(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') api.close(); });
api.onFrame(nf => { f = nf; render(); });
