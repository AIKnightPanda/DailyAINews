#!/usr/bin/env node

// ============================================================================
// 生成阅读器
// ============================================================================
// 扫描 digests/*.md，把数据注入 viewer/template.html，产出两个自包含文件：
//
//   viewer/index.html     完整 HTML，双击即可打开
//   viewer/artifact.html  去掉外层骨架，供 Artifact 发布（发布时平台会自己包骨架）
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIGEST_DIR = join(ROOT, 'digests');
const RAW_DIR = join(DIGEST_DIR, 'raw');
const VIEWER_DIR = join(ROOT, 'viewer');
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

async function main() {
  if (!existsSync(TEMPLATE)) {
    console.error(`找不到模板: ${TEMPLATE}`);
    process.exit(1);
  }

  const issues = await collectIssues();
  const template = await readFile(TEMPLATE, 'utf-8');

  // 转义 < 防止正文里的 </script> 提前闭合标签（< 在 JSON 里等价于 <）
  const payload = JSON.stringify({ builtAt: new Date().toISOString(), issues })
    .replace(/</g, '\\u003c');

  if (!DATA_SLOT.test(template)) {
    console.error('模板里找不到数据占位符 /*__DIGEST_DATA__*/…/*__END__*/');
    process.exit(1);
  }
  const filled = template.replace(DATA_SLOT, () => payload);

  await mkdir(VIEWER_DIR, { recursive: true });

  // Artifact 版：平台发布时自带 doctype/head/body，这里只留内容
  await writeFile(join(VIEWER_DIR, 'artifact.html'), filled.replace(HEAD_END, ''));

  // 本地版：补回外层骨架，双击就能看
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
  await writeFile(join(VIEWER_DIR, 'index.html'), local);

  const archived = issues.filter(i => !i.rawMissing).length;
  const kb = n => (n / 1024).toFixed(0) + 'KB';
  console.log(`已生成 viewer/index.html (${kb(local.length)}) 与 viewer/artifact.html (${kb(filled.length)})：${issues.length} 期，其中 ${archived} 期含原始数据`);
  for (const i of issues) {
    console.log(`  ${i.issue}  ${i.rawMissing ? '无 raw' : kb(i.rawBytes)}\t${i.headline.slice(0, 40)}`);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
