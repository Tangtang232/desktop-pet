const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/main/update-check.js');
const T = require('../src/main/together.js');

test('版本号比较：只认 x.y.z，按数字比', () => {
  assert.equal(U.isNewer('0.2.0', '0.1.0'), true);
  assert.equal(U.isNewer('v0.1.10', '0.1.9'), true);   // 10 > 9，不是按字符串比
  assert.equal(U.isNewer('1.0.0', '0.9.9'), true);
  assert.equal(U.isNewer('0.1.0', '0.1.0'), false);
  assert.equal(U.isNewer('0.0.9', '0.1.0'), false);
  assert.equal(U.isNewer('0.2.0-beta', '0.1.0'), false);   // 预发布不提醒
  assert.equal(U.isNewer('', '0.1.0'), false);
  assert.equal(U.isNewer(null, '0.1.0'), false);
});

test('仓库地址：homepage / repository 都认，别的网站不认', () => {
  assert.equal(U.parseRepo({ homepage: 'https://github.com/a-b/c.d' }), 'a-b/c.d');
  assert.equal(U.parseRepo({ repository: { url: 'https://github.com/a/b.git' } }), 'a/b');
  assert.equal(U.parseRepo({ repository: 'git@github.com:a/b.git' }), 'a/b');
  assert.equal(U.parseRepo({ homepage: 'https://example.com/a/b' }), null);
  assert.equal(U.parseRepo({}), null);
});

test('下载页只开这个仓库自己的 Releases', () => {
  assert.equal(U.releasePage('a/b', 'https://github.com/a/b/releases/tag/v1.0.0'), 'https://github.com/a/b/releases/tag/v1.0.0');
  assert.equal(U.releasePage('a/b', 'https://evil.example/a/b/releases/'), 'https://github.com/a/b/releases/latest');
  assert.equal(U.releasePage('a/b', 'https://github.com/x/y/releases/tag/v1'), 'https://github.com/a/b/releases/latest');
  assert.equal(U.releasePage('a/b', undefined), 'https://github.com/a/b/releases/latest');
});

function fakeGitHub(reply) {
  const calls = [];
  const fetch = async (url, opts) => { calls.push({ url, opts }); return reply(); };
  return { calls, fetch };
}
const ok = json => ({ ok: true, status: 200, json: async () => json });
function make(fetch, current = '0.1.0', stored = {}) {
  let saved = stored; const said = [];
  const u = U.create({ fetch, repo: 'a/b', current, store: { get: () => saved, set: v => { saved = v; } }, notify: t => said.push(t), onChange: () => {} });
  return { u, said, saved: () => saved };
}

test('有新版本：托盘菜单拿得到，同一个版本只提示一次；请求不带个人信息', async () => {
  const gh = fakeGitHub(() => ok({ tag_name: 'v0.2.0', html_url: 'https://github.com/a/b/releases/tag/v0.2.0' }));
  const { u, said, saved } = make(gh.fetch);
  assert.equal(u.latest(), null);
  await u.check(false);
  assert.deepEqual(u.latest(), { version: '0.2.0', url: 'https://github.com/a/b/releases/tag/v0.2.0' });
  assert.equal(said.length, 1);
  await u.check(false);
  assert.equal(said.length, 1, '同一个版本不再提示');
  assert.equal(saved().notified, '0.2.0');
  assert.equal(gh.calls[0].url, 'https://api.github.com/repos/a/b/releases/latest');
  assert.deepEqual(Object.keys(gh.calls[0].opts.headers).sort(), ['Accept', 'User-Agent', 'X-GitHub-Api-Version']);
  assert.equal(gh.calls[0].opts.headers['User-Agent'], 'desktop-pet-update-check');
});

test('已经最新、还没发布过、连不上：自动检查不打扰，手动检查才说', async () => {
  const same = make(fakeGitHub(() => ok({ tag_name: 'v0.1.0', html_url: 'https://github.com/a/b/releases/tag/v0.1.0' })).fetch);
  await same.u.check(false);
  assert.equal(same.u.latest(), null); assert.equal(same.said.length, 0);
  await same.u.check(true);
  assert.match(same.said[0], /已经是最新版本/);

  const none = make(fakeGitHub(() => ({ ok: false, status: 404, json: async () => ({}) })).fetch);
  const r = await none.u.check(false);
  assert.equal(r.ok, true); assert.equal(none.u.latest(), null); assert.equal(none.said.length, 0);

  const down = make(async () => { throw new Error('offline'); });
  assert.equal((await down.u.check(false)).ok, false); assert.equal(down.said.length, 0);
  await down.u.check(true);
  assert.match(down.said[0], /没连上 GitHub/);
});

test('装了新版本以后，旧的"有新版本"记录自己失效', () => {
  const { u } = make(async () => ok({}), '0.2.0', { at: 1, version: '0.2.0', url: 'https://github.com/a/b/releases/tag/v0.2.0', notified: '0.2.0' });
  assert.equal(u.latest(), null);
});

test('打包前的配置检查：只放行 supabase.co 地址加公开密钥', () => {
  assert.ok(T.checkConfig({ url: 'https://abcd1234.supabase.co', publishableKey: 'sb_publishable_xxx' }));
  assert.equal(T.checkConfig({ url: 'http://abcd1234.supabase.co', publishableKey: 'sb_publishable_xxx' }), null);
  assert.equal(T.checkConfig({ url: 'https://abcd1234.supabase.co', publishableKey: 'sb_secret_xxx' }), null);
  assert.equal(T.checkConfig({ url: 'https://abcd1234.supabase.co', publishableKey: '' }), null);
  assert.equal(T.checkConfig(null), null);
});
