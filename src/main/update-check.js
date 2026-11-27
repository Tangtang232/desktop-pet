// 新版本提醒：装好的版本每 12 小时问一次 GitHub 上最新发布的版本号，比自己新就在托盘菜单里放一条"有新版本"，
// 每个新版本只弹一次托盘提示。请求里不带任何个人信息；不自动下载、不自动安装，点了才用浏览器打开下载页。
// 不依赖 electron：联网函数、存储、提示都由主进程传进来，单元测试可以直接跑。
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 60 * 1000;   // 开机后等一分钟再问，不跟开机抢网络
const TICK_MS = 60 * 60 * 1000;           // 每小时看一眼到没到 12 小时（电脑睡过一觉也不会漏）

// "1.2.3"、"v1.2.3" → [1, 2, 3]；带预发布后缀（1.2.3-beta）或格式不对的不算
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/i.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
// package.json 的 homepage / repository → "owner/name"（只认 github.com）
function parseRepo(pkg) {
  const urls = [pkg && pkg.homepage, pkg && pkg.repository && (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url)];
  for (const u of urls) {
    const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(u || ''));
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
}
// 下载页只开这个仓库自己的 Releases 页面，接口返回别的地址一律不用
function releasePage(repo, url) {
  const base = `https://github.com/${repo}/releases/`;
  return typeof url === 'string' && url.startsWith(base) ? url : `${base}latest`;
}

async function fetchLatest(fetchImpl, repo) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'desktop-pet-update-check', 'X-GitHub-Api-Version': '2022-11-28' }
  });
  if (res.status === 404) return { none: true };   // 还没发布过任何版本
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const j = await res.json();
  const version = parseVersion(j && j.tag_name);
  if (!version) return { none: true };
  return { version: version.join('.'), url: releasePage(repo, j.html_url) };
}

// opts: fetch, repo, current（自己的版本号）, store {get(), set(v)}, notify(text), onChange(), now()
function create(opts) {
  const now = opts.now || Date.now;
  let saved = Object.assign({ at: 0, version: null, url: null, notified: null }, opts.store.get() || {});
  let timer = null, firstTimer = null, busy = null;

  const latest = () => (saved.version && isNewer(saved.version, opts.current)) ? { version: saved.version, url: releasePage(opts.repo, saved.url) } : null;
  function save(patch) { saved = Object.assign({}, saved, patch); opts.store.set(saved); }

  async function check(manual) {
    if (busy) return busy;
    busy = (async () => {
      try {
        const r = await fetchLatest(opts.fetch, opts.repo);
        save({ at: now(), version: r.none ? null : r.version, url: r.none ? null : r.url });
        const l = latest();
        if (l && (manual || saved.notified !== l.version)) {
          opts.notify(`桌面比格有新版本 ${l.version} 了，右键托盘图标点「有新版本」去下载`);
          save({ notified: l.version });
        } else if (manual) {
          opts.notify(`已经是最新版本（${opts.current}）`);
        }
        if (opts.onChange) opts.onChange();
        return { ok: true, latest: l };
      } catch (err) {
        // 没网、GitHub 连不上：不打扰，下个钟头再说；只有手动点的才告诉你
        if (manual) opts.notify('没连上 GitHub，过会儿再试试');
        return { ok: false, error: String(err && err.message || err) };
      } finally { busy = null; }
    })();
    return busy;
  }
  function start() {
    if (timer) return;
    const due = () => now() - saved.at >= CHECK_EVERY_MS;
    firstTimer = setTimeout(() => { firstTimer = null; if (due()) check(false); }, FIRST_CHECK_DELAY_MS);
    timer = setInterval(() => { if (due()) check(false); }, TICK_MS);
    if (timer.unref) timer.unref();
    if (firstTimer.unref) firstTimer.unref();
  }
  function stop() { clearTimeout(firstTimer); clearInterval(timer); firstTimer = timer = null; }
  return { start, stop, check, latest, get page() { return `https://github.com/${opts.repo}`; } };
}

module.exports = { create, isNewer, parseVersion, parseRepo, releasePage, fetchLatest, CHECK_EVERY_MS };
