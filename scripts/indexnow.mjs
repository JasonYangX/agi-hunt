#!/usr/bin/env node
/* ============================================================
 * IndexNow 批量提交（Bing / Yandex / Seznam 共用协议，百度不支持）
 *
 * 用法：
 *   node scripts/indexnow.mjs --dry-run   # 只打印，不发请求
 *   node scripts/indexnow.mjs             # 提交 dist/urls.txt 里的全部 URL
 *
 * 前置条件：
 *   1. 仓库根目录存在 32 位十六进制的密钥文件（构建时会复制到站点根）
 *   2. 站点已部署，且 https://www.agihunt.cn/<key>.txt 可公开访问
 *
 * 说明：IndexNow 单次上限 10000 条；重复提交同一 URL 无副作用，
 * 但没必要每天全量推——只在内容有实质变更后跑一次。
 * ============================================================ */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOST = 'www.agihunt.cn';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const keyFile = readdirSync(ROOT).find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
if (!keyFile) {
  console.error('未找到 IndexNow 密钥文件：根目录应有 {32位十六进制}.txt');
  process.exit(1);
}
const key = keyFile.replace(/\.txt$/, '');

const listPath = join(ROOT, 'dist/urls.txt');
if (!existsSync(listPath)) {
  console.error('未找到 dist/urls.txt，请先运行 node build.mjs');
  process.exit(1);
}
const urlList = readFileSync(listPath, 'utf8')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const payload = {
  host: HOST,
  key,
  keyLocation: `https://${HOST}/${keyFile}`,
  urlList
};

if (process.argv.includes('--dry-run')) {
  console.log(`密钥文件：${keyFile}`);
  console.log(`待提交：${urlList.length} 条 URL`);
  console.log(`端点：${ENDPOINT}`);
  console.log(`样例：${urlList.slice(0, 3).join('\n      ')}`);
  process.exit(0);
}

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload)
});

console.log(`提交 ${urlList.length} 条 URL → HTTP ${res.status}`);
if (res.status === 200 || res.status === 202) {
  console.log('已接受。Bing 侧通常 24-72 小时完成抓取，可在 Bing 站长工具「URL 提交」查看。');
} else {
  console.log(await res.text());
  process.exit(1);
}
