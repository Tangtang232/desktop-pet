// 打包前检查（npm run dist 会先跑它）：config/supabase.json 不在或不能用时不让打包。
// 不然打出来的安装包能装能用，但"一起养"是关着的，朋友装了也连不上，很难看出来哪儿不对。
// 只说行不行，不把地址和密钥打印出来。
'use strict';
const fs = require('fs');
const path = require('path');
const { checkConfig } = require('../../src/main/together.js');

const root = path.join(__dirname, '..', '..');
const file = path.join(root, 'config', 'supabase.json');
const fail = msg => { console.error(`[preflight] ${msg}`); process.exit(1); };

let cfg = null;
try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
  fail(`没找到能读的 config/supabase.json（${err.code || err.message}）。它在仓库里，用 git checkout config/supabase.json 恢复再打包，不然安装包里没有合养。`);
}
const why = [];
if (!checkConfig(cfg, m => why.push(m))) fail(`config/supabase.json 不能用：${why[0] || '地址要是 https://<项目>.supabase.co，密钥要填公开密钥（Publishable key）'}`);

const pkg = require(path.join(root, 'package.json'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) fail(`package.json 的版本号 ${pkg.version} 不是 x.y.z 的样子，新版本提醒认不出来`);
console.log(`[preflight] 合养配置能用，版本 ${pkg.version}，开始打包`);
