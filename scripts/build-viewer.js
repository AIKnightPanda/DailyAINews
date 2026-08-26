#!/usr/bin/env node

// ============================================================================
// 生成阅读器
// ============================================================================
// 扫描 digests/*.md，把数据注入 viewer/template.html，产出两个自包含文件：
//
//   docs/index.html       完整 HTML。GitHub Pages 以 /docs 为站点根目录提供服务，
//                         同时也能双击直接打开
//   docs/source/<期号>.json  该期的英文原文（推文/博客/播客转录全量），
//                         供页面的「EN 原文」视图按需加载 —— 不内联，页面体积才不会随期数膨胀
//   viewer/artifact.html  去掉外层骨架，留作手动发布 Artifact 用（平台会自己包骨架）
//
// 两份都把数据内联在 <script> 里 —— 不依赖同目录的 .js，file:// 下也不受 CORS 限制。
// 关键：HTML 由脚本拼装，不经过模型输出，所以 Routine 的 token 消耗不随期数增长。
//
// 用法: node scripts/build-viewer.js
// ============================================================================

import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SOURCE_ORDER, SOURCES } from './groups.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIGEST_DIR = join(ROOT, 'digests');
const RAW_DIR = join(DIGEST_DIR, 'raw');
const VIEWER_DIR = join(ROOT, 'viewer');
const DOCS_DIR = join(ROOT, 'docs');
const SOURCE_DIR = join(DOCS_DIR, 'source');
const TEMPLATE = join(VIEWER_DIR, 'template.html');

const DATA_SLOT = /\/\*__DIGEST_DATA__\*\/[\s\S]*?\/\*__END__\*\//;
const HEAD_END = '<!--__HEAD_END__-->';

// 扁平 YAML frontmatter：只需支持 `key: value`，不引第三方解析器
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const raw = kv[2].trim();
    let value = raw;
    if (raw === 'true') value = true;
    else if (raw === 'false') value = false;
    else if (raw !== '' && !Number.isNaN(Number(raw))) value = Number(raw);
    meta[kv[1]] = value;
  }
  return { meta, body: text.slice(match[0].length) };
}

async function collectIssues() {
  const files = (await readdir(DIGEST_DIR))
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .reverse(); // 最新一期在前

  const issues = [];
  for (const file of files) {
    const text = await readFile(join(DIGEST_DIR, file), 'utf-8');
    const { meta, body } = parseFrontmatter(text);
    const issue = meta.issue || file.replace(/\.md$/, '');

    const rawPath = join(RAW_DIR, `${issue}.json`);
    let rawBytes = 0;
    if (existsSync(rawPath)) rawBytes = (await stat(rawPath)).size;

    issues.push({
      issue,
      headline: meta.headline || '',
      feedGeneratedAt: meta.feed_generated_at || null,
      stats: {
        builders: meta.builders || 0,
        tweets: meta.tweets || 0,
        blogs: meta.blogs || 0,
        podcasts: meta.podcasts || 0
      },
      rawBytes,
      rawMissing: rawBytes === 0,
      body: body.trim()
    });
  }
  return issues;
}

// 页面右上角「信息源」面板的数据。
// **照配置念，不做统计。** 上游那半边直接读 follow-builders 的源清单，
// 补充源那半边读 scripts/groups.js 的注册表 —— 两份都是实际抓取用的配置本身。
// 早先是扫各期存档反推的，那只能得到「最近露过面的」：feed 每天只报当天有
// 内容的人，26 个 X 账号里只汇总出 18 个，说是「信息源」其实名不副实。
async function collectSourceManifest() {
  const FEED_SOURCES = join(ROOT, '.claude', 'skills', 'follow-builders',
    'config', 'default-sources.json');

  let upstream = { x_accounts: [], blogs: [], podcasts: [] };
  if (existsSync(FEED_SOURCES)) {
    try { upstream = JSON.parse(await readFile(FEED_SOURCES, 'utf-8')); }
    catch { /* 读不到就只展示补充源，不让页面出不来 */ }
  } else {
    console.warn('[build-viewer] 找不到上游源清单，信息源面板只列补充源');
  }

  return {
    builders: (upstream.x_accounts || []).map(a => ({ name: a.name, handle: a.handle })),
    blogs: (upstream.blogs || []).map(b => ({ name: b.name, url: b.indexUrl || null })),
    podcasts: (upstream.podcasts || []).map(p => ({ name: p.name, url: p.url || p.rssUrl || null })),
    extra: SOURCE_ORDER
      .map(n => SOURCES.find(s => s.name === n))
      .filter(Boolean)
      .map(s => ({ name: s.name, home: s.home, note: s.note || '' }))
  };
}

async function main() {
  if (!existsSync(TEMPLATE)) {
    console.error(`找不到模板: ${TEMPLATE}`);
    process.exit(1);
  }

  const issues = await collectIssues();
  const sourceManifest = await collectSourceManifest();

  const template = await readFile(TEMPLATE, 'utf-8');

  // 转义 < 防止正文里的 </script> 提前闭合标签（< 在 JSON 里等价于 <）
  const payload = JSON.stringify({ builtAt: new Date().toISOString(), sourceOrder: SOURCE_ORDER, sourceManifest, issues })
    .replace(/</g, '\\u003c');

  if (!DATA_SLOT.test(template)) {
    console.error('模板里找不到数据占位符 /*__DIGEST_DATA__*/…/*__END__*/');
    process.exit(1);
  }
  const filled = template.replace(DATA_SLOT, () => payload);

  await mkdir(VIEWER_DIR, { recursive: true });
  await mkdir(DOCS_DIR, { recursive: true });

  // Artifact 版：平台发布时自带 doctype/head/body，这里只留内容
  await writeFile(join(VIEWER_DIR, 'artifact.html'), filled.replace(HEAD_END, ''));

  // 站点版：补回外层骨架，Pages 和本地双击共用这一份
  const idx = filled.indexOf(HEAD_END);
  if (idx === -1) {
    console.error(`模板里找不到分隔标记 ${HEAD_END}`);
    process.exit(1);
  }
  const head = filled.slice(0, idx);
  const bodyPart = filled.slice(idx + HEAD_END.length);
  const local = '<!doctype html>\n<html lang="zh-CN">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    head + '</head>\n<body>' + bodyPart + '\n</body>\n</html>\n';
  await writeFile(join(DOCS_DIR, 'index.html'), local);
  // 关掉 Jekyll，避免它对站点文件做多余处理
  await writeFile(join(DOCS_DIR, '.nojekyll'), '');

  // 英文原文：每期单独一个文件，页面点「EN」时才去取。
  // 丢掉 prompts 字段 —— 那是给模型的指令，不是内容。
  await mkdir(SOURCE_DIR, { recursive: true });
  let sourceCount = 0;
  let extraCount = 0;
  for (const it of issues) {
    const rawPath = join(RAW_DIR, `${it.issue}.json`);
    if (!existsSync(rawPath)) continue;
    const raw = JSON.parse(await readFile(rawPath, 'utf-8'));
    await writeFile(join(SOURCE_DIR, `${it.issue}.json`), JSON.stringify({
      issue: it.issue,
      generatedAt: raw.stats?.feedGeneratedAt || null,
      stats: raw.stats || {},
      x: raw.x || [],
      blogs: raw.blogs || [],
      podcasts: raw.podcasts || [],
      // 补充源的链接墙。URL 从抓取到渲染全程由脚本传递，不经过任何模型。
      extra: raw.extra || { items: [], sources: [] }
    }));
    sourceCount++;
    extraCount += (raw.extra?.items || []).length;
  }

  const archived = issues.filter(i => !i.rawMissing).length;
  const kb = n => (n / 1024).toFixed(0) + 'KB';
  console.log(`已生成 docs/index.html (${kb(local.length)}) 与 viewer/artifact.html (${kb(filled.length)})：${issues.length} 期，其中 ${archived} 期含原始数据`);
  console.log(`英文原文导出 docs/source/：${sourceCount} 期，含补充链接 ${extraCount} 条`);
  for (const i of issues) {
    console.log(`  ${i.issue}  ${i.rawMissing ? '无 raw' : kb(i.rawBytes)}\t${i.headline.slice(0, 40)}`);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
