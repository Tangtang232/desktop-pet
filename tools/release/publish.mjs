// 把打好的安装包发到 GitHub Releases（npm run release）。先跑 npm run dist，代码提交并推上去以后再跑这个。
//
// 做的事：检查安装包里带着合养配置 → 建一个草稿 Release（标签 v<版本号>，指向已经推上去的这次提交）
// → 传安装包、压缩包、SHA256 校验文件 → 都传完了才正式发布，朋友不会看到缺文件的半成品。
// 中途断了可以再跑一次：同一个版本的草稿会接着用，传过的同名文件会先删掉重传。
//
// GitHub 登录：有 GH_TOKEN / GITHUB_TOKEN 环境变量就用它；没有就问 git 的凭据管理器要（和 git push 用的是同一个），
// 不弹窗、不打印、不写盘。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = require(path.join(root, 'package.json'));
const { parseRepo } = require(path.join(root, 'src', 'main', 'update-check.js'));
const say = msg => console.log(`[release] ${msg}`);
const fail = msg => { console.error(`[release] ${msg}`); process.exit(1); };
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } }).trim();

const version = pkg.version, tag = `v${version}`;
const repo = parseRepo(pkg);
if (!repo) fail('package.json 里没写 GitHub 仓库地址（homepage / repository）');
const dryRun = process.argv.includes('--dry-run');

// ---------- 要传的文件 ----------
const dist = path.join(root, 'dist');
const files = [`DesktopPet-Setup-${version}.exe`, `DesktopPet-${version}-win-x64.zip`].map(n => path.join(dist, n));
for (const f of files) if (!existsSync(f)) fail(`没找到 ${path.relative(root, f)}，先跑 npm run dist`);

// 安装包里得带着合养配置（压缩包和安装包是同一份程序，看 win-unpacked 那份就行）
try {
  const asar = require('@electron/asar');
  const list = asar.listPackage(path.join(dist, 'win-unpacked', 'resources', 'app.asar')).map(p => p.replace(/\\/g, '/'));
  if (!list.includes('/config/supabase.json')) fail('打出来的程序里没有 config/supabase.json，朋友装了连不上。建好配置重新 npm run dist');
  const pv = JSON.parse(asar.extractFile(path.join(dist, 'win-unpacked', 'resources', 'app.asar'), 'package.json').toString()).version;
  if (pv !== version) fail(`dist 里的程序是 ${pv} 版，package.json 是 ${version}：重新 npm run dist`);
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND') say('（没装 @electron/asar，跳过安装包内容检查）'); else throw err;
}

// ---------- 代码得先推上去：标签要指向 GitHub 上有的那次提交 ----------
if (git('status', '--porcelain')) fail('还有没提交的改动，先提交并推上去');
const head = git('rev-parse', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const remoteHead = (git('ls-remote', 'origin', `refs/heads/${branch}`).split(/\s/)[0]) || '';
if (remoteHead !== head) fail(`本地的 ${branch} 还没推到 GitHub（本地 ${head.slice(0, 7)}，GitHub ${remoteHead.slice(0, 7) || '没有'}），先 git push`);

// ---------- 校验文件 ----------
const sums = files.map(f => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${path.basename(f)}`).join('\n') + '\n';
const notesFile = path.join(root, 'docs', 'release-notes', `${version}.md`);
const notes = existsSync(notesFile) ? readFileSync(notesFile, 'utf8').trim() : `桌面比格 ${version}`;
const body = `${notes}\n\n---\n\n**SHA256**\n\n\`\`\`\n${sums}\`\`\`\n`;

if (dryRun) {
  say(`试跑：会在 ${repo} 发 ${tag}（提交 ${head.slice(0, 7)}），带这些文件：`);
  for (const f of files) say(`  ${path.basename(f)}  ${(statSync(f).size / 1048576).toFixed(1)} MB`);
  say('  SHA256SUMS.txt');
  process.exit(0);
}

// ---------- GitHub 登录 ----------
function token() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  let out = '';
  try {
    out = execFileSync('git', ['credential', 'fill'], {
      cwd: root, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, stdio: ['pipe', 'pipe', 'ignore']
    });
  } catch { /* 下面统一报 */ }
  const m = /^password=(.+)$/m.exec(out);
  if (!m) fail('拿不到 GitHub 登录：设一个 GH_TOKEN 环境变量，或者先用 git push 登录一次 GitHub');
  return m[1].trim();
}
const auth = { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'desktop-pet-release' };
async function api(method, url, data, extra = {}) {
  const res = await fetch(url.startsWith('https://') ? url : `https://api.github.com${url}`, {
    method, headers: { ...auth, ...(data && !Buffer.isBuffer(data) ? { 'Content-Type': 'application/json' } : {}), ...extra },
    body: data == null ? undefined : Buffer.isBuffer(data) ? data : JSON.stringify(data)
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.split('?')[0]} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// ---------- 建草稿、传文件、发布 ----------
const existing = (await api('GET', `/repos/${repo}/releases?per_page=30`)).find(r => r.tag_name === tag);
if (existing && !existing.draft) fail(`${tag} 已经发布过了：改 package.json 的版本号再发`);
const rel = existing || await api('POST', `/repos/${repo}/releases`, { tag_name: tag, target_commitish: head, name: `桌面比格 ${version}`, body, draft: true });
if (existing) await api('PATCH', `/repos/${repo}/releases/${rel.id}`, { target_commitish: head, name: `桌面比格 ${version}`, body });
say(`${existing ? '接着用' : '建好'}草稿 ${tag}`);

const uploads = [...files.map(f => ({ name: path.basename(f), data: readFileSync(f), type: f.endsWith('.zip') ? 'application/zip' : 'application/octet-stream' })),
  { name: 'SHA256SUMS.txt', data: Buffer.from(sums), type: 'text/plain' }];
for (const u of uploads) {
  const old = (rel.assets || []).find(a => a.name === u.name);
  if (old) await api('DELETE', `/repos/${repo}/releases/assets/${old.id}`);
  say(`上传 ${u.name}（${(u.data.length / 1048576).toFixed(1)} MB）…`);
  await api('POST', `https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(u.name)}`, u.data, { 'Content-Type': u.type });
}
const done = await api('PATCH', `/repos/${repo}/releases/${rel.id}`, { draft: false, make_latest: 'true' });
say(`发布好了：${done.html_url}`);
