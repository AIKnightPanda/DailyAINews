#!/usr/bin/env node

// ============================================================================
// 把一期原始数据压成模型可直接读的素材
// ============================================================================
// raw JSON 里播客转录动辄五万字符，整份读进去很浪费。这里做两件事：
//   1. 推文/博客按需截断
//   2. 转录只按比例采样几段（开头 + 中后段），保留足够写出 200-400 字的密度
//
// 输出纯文本到 stdout。这是 Routine 里唯一喂给模型的东西，
// 体积大致是原始 JSON 的三分之一。
//
// 用法: node scripts/extract.js <期号>
// ============================================================================

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const issue = process.argv[2];
if (!issue) {
  console.error('用法: node scripts/extract.js <期号，如 2026-08-22>');
  process.exit(1);
}

const BLOG_CHARS = 3500;        // 博客正文上限
const POD_HEAD = 4000;          // 转录开头
const POD_SAMPLES = [0.3, 0.55, 0.8]; // 中后段采样点
const POD_SAMPLE_CHARS = 3000;

const clean = s => (s || '').replace(/\r?\n/g, ' ⏎ ');

const data = JSON.parse(await readFile(join(ROOT, 'digests/raw', `${issue}.json`), 'utf-8'));
const out = [];

out.push(`# 第 ${issue} 期素材`);
out.push(`feed 生成于 ${data.stats.feedGeneratedAt}`);
out.push(`统计：${data.stats.xBuilders} 位建造者 / ${data.stats.totalTweets} 条推文 / ${data.stats.blogPosts} 篇博客 / ${data.stats.podcastEpisodes} 期播客`);

// ── 推文 ────────────────────────────────────────────────────────
out.push('\n## 推文');
for (const author of data.x || []) {
  if (!author.tweets?.length) continue;
  out.push(`\n### ${author.name}（${author.handle} on X）`);
  const bio = clean(author.bio).slice(0, 110);
  if (bio) out.push(`简介：${bio}`);
  for (const t of author.tweets) {
    out.push(`- ${clean(t.text)}`);
    out.push(`  ${t.url}`);
  }
}

// ── 博客 ────────────────────────────────────────────────────────
if (data.blogs?.length) {
  out.push('\n## 官方博客');
  for (const b of data.blogs) {
    out.push(`\n### ${b.name}：${b.title}`);
    if (b.author) out.push(`作者：${b.author}`);
    if (b.publishedAt) out.push(`发布：${b.publishedAt}`);
    out.push(`链接：${b.url}`);
    const body = (b.content || '').trim();
    out.push(body.slice(0, BLOG_CHARS) + (body.length > BLOG_CHARS ? '\n[正文已截断]' : ''));
  }
} else {
  out.push('\n## 官方博客\n（本期无新增博客，简报里跳过该板块）');
}

// ── 播客 ────────────────────────────────────────────────────────
if (data.podcasts?.length) {
  out.push('\n## 播客');
  for (const p of data.podcasts) {
    out.push(`\n### ${p.name}：${p.title}`);
    out.push(`发布：${p.publishedAt}`);
    out.push(`链接：${p.url}`);
    // 频道页链接不是具体某期，简报里要如实标注这个缺口
    if (/youtube\.com\/@/.test(p.url || '')) {
      out.push('⚠️ 注意：feed 只给了频道页链接，没有具体视频 URL —— 简报里要如实标注这个数据缺口。');
    }
    const t = p.transcript || '';
    out.push(`转录全长 ${t.length} 字符，以下为采样片段：`);
    out.push(`\n--- 开头 ---\n${t.slice(0, POD_HEAD)}`);
    for (const at of POD_SAMPLES) {
      const start = Math.floor(t.length * at);
      if (start >= t.length) continue;
      out.push(`\n--- ${Math.round(at * 100)}% 处 ---\n${t.slice(start, start + POD_SAMPLE_CHARS)}`);
    }
  }
}

// ── 官方改写指令 ────────────────────────────────────────────────
out.push('\n## 上游官方改写指令（请遵循）');
for (const key of ['summarize_tweets', 'summarize_blogs', 'summarize_podcast', 'digest_intro']) {
  if (data.prompts?.[key]) out.push(`\n### ${key}\n${data.prompts[key]}`);
}

const text = out.join('\n');
console.error(`[extract] ${issue}：原始 JSON ${(JSON.stringify(data).length / 1024).toFixed(0)}KB → 素材 ${(text.length / 1024).toFixed(0)}KB`);
console.log(text);
