#!/usr/bin/env node

// ============================================================================
// 把一期原始数据压成模型可直接读的素材
// ============================================================================
// raw JSON 里播客转录动辄五万字符，整份读进去很浪费。这里做两件事：
//   1. 推文/博客按需截断
//   2. 转录用 Haiku 预压缩过的摘要；没有摘要时退回按比例采样
//
// 输出纯文本到 stdout。这是写简报的模型唯一需要读的东西。
//
// 补充源（AINews / Import AI / 官方博客）以 [E<n>] 编号列表的形式进入素材，
// **只给编号和标题，不给 URL**：一天几十条，条数一多模型容易把标题和链接配错，
// 改由 link-digest.js 按编号配回就错不了。这道隔离只针对补充源那一节 ——
// 推文、博客原文、博客正文里的链接都照常进素材，那些是内容。
//
// 用法:
//   node scripts/extract.js <期号>                 写简报用的素材
//   node scripts/extract.js <期号> --transcripts   播客转录全文，喂给 Haiku 压缩
// ============================================================================

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { bodyToMarkdown } from './blog-body.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const issue = process.argv[2];
if (!issue) {
  console.error('用法: node scripts/extract.js <期号，如 2026-08-22> [--transcripts]');
  process.exit(1);
}
const transcriptMode = process.argv.includes('--transcripts');

const BLOG_CHARS = 6000;        // 博客正文上限。还原分段后原来的 3500 会砍掉大半篇
                                //（08-27 那篇 6900 字符），而博客一天只有 1-3 篇，
                                // 放宽的这点额度换来的是简报里博客那节写得准
const POD_HEAD = 4000;          // 转录开头
const POD_SAMPLES = [0.3, 0.55, 0.8]; // 中后段采样点
const POD_SAMPLE_CHARS = 3000;

const clean = s => (s || '').replace(/\r?\n/g, ' ⏎ ');

// 超额时按段落边界截断，不要把一段话砍在半句上
function clip(text, limit) {
  if (text.length <= limit) return text;
  const paras = text.split('\n\n');
  const out = [];
  let n = 0;
  for (const p of paras) {
    if (n + p.length > limit && out.length) break;
    out.push(p);
    n += p.length + 2;
  }
  return out.join('\n\n') + '\n\n[正文已截断]';
}

const data = JSON.parse(await readFile(join(ROOT, 'digests/raw', `${issue}.json`), 'utf-8'));

// ── 转录全文模式：给 Haiku 子代理读 ──────────────────────────────
// 单独走一条路，因为这里要的恰恰是「不压缩」。
if (transcriptMode) {
  const pods = data.podcasts || [];
  if (!pods.length) {
    console.error(`[extract] ${issue}：本期无播客`);
    console.log('（本期无播客）');
    process.exit(0);
  }
  const parts = pods.map((p, i) => [
    `## 第 ${i + 1} 期播客`,
    `节目：${p.name}`,
    `标题：${p.title}`,
    `链接：${p.url}`,
    '',
    '--- 转录全文开始 ---',
    p.transcript || '（无转录）',
    '--- 转录全文结束 ---'
  ].join('\n'));
  const text = parts.join('\n\n');
  console.error(`[extract] ${issue}：转录全文 ${(text.length / 1024).toFixed(0)}KB（${pods.length} 期）`);
  console.log(text);
  process.exit(0);
}

// Haiku 预压缩的摘要，有就用，没有就退回采样
let summaries = null;
try {
  summaries = JSON.parse(await readFile(join(ROOT, 'digests/summaries', `${issue}.json`), 'utf-8'));
} catch {
  summaries = null;
}

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
    // 用还原后的分段正文（带小标题和正文内链接）；没还原成功时退回扁平正文。
    // 正文里的 [文字](URL) 是**文章自己引用的链接**，属于内容的一部分，
    // 写简报时该带就带 —— 和末尾「补充源条目」那套编号引用是两码事。
    const body = bodyToMarkdown(b).trim();
    if (!b.body?.length) out.push('⚠️ 本篇未能还原分段，下面是扁平正文。');
    out.push(clip(body, BLOG_CHARS));
  }
} else {
  out.push('\n## 官方博客\n（本期无新增博客，简报里跳过该板块）');
}

// ── 播客 ────────────────────────────────────────────────────────
if (data.podcasts?.length) {
  out.push('\n## 播客');
  for (const [i, p] of data.podcasts.entries()) {
    out.push(`\n### ${p.name}：${p.title}`);
    out.push(`发布：${p.publishedAt}`);
    out.push(`链接：${p.url}`);
    // 频道页/播放列表链接不是具体某期。这条提示写得越像「警告」，模型越容易
    // 把整条当成残缺品处理 —— 2026-08-29、08-30 两期就是这样：标题和 🔗 行
    // 一起被省了，读者根本不知道讲的是哪一集。所以这里只说该怎么做。
    if (/youtube\.com\/@|[?&]list=/.test(p.url || '')) {
      out.push('ℹ️ 这条只有频道页/播放列表链接，没有单集 URL。**照常写这一条**：' +
        '标题照写、🔗 行照给（指向上面这个链接），末尾用 `> ⚠️ 数据说明：…` 说明缺的是单集链接。');
    }
    const t = p.transcript || '';
    const pre = summaries?.podcasts?.[i];

    if (pre) {
      // Haiku 读完整份转录后的产出 —— 是「先理解再取舍」，
      // 不是下面那种碰运气的定点采样
      out.push(`转录全长 ${t.length} 字符。以下是通读全文后提炼的要点（非采样，覆盖整期）：`);
      out.push(pre);
    } else {
      out.push(`转录全长 ${t.length} 字符，以下为采样片段（⚠️ 只覆盖约 ${Math.round((POD_HEAD + POD_SAMPLES.length * POD_SAMPLE_CHARS) / Math.max(t.length, 1) * 100)}%，未见部分不要臆测）：`);
      out.push(`\n--- 开头 ---\n${t.slice(0, POD_HEAD)}`);
      for (const at of POD_SAMPLES) {
        const start = Math.floor(t.length * at);
        if (start >= t.length) continue;
        out.push(`\n--- ${Math.round(at * 100)}% 处 ---\n${t.slice(start, start + POD_SAMPLE_CHARS)}`);
      }
    }
  }
}

// ── 补充源条目 ──────────────────────────────────────────────────
// 只给编号和标题，URL 不给。这一节一天几十条，条数一多模型很容易把标题和
// 链接配错；改成编号引用后由 link-digest.js 按编号配回，错不了。
// 注意这道隔离**只针对这一节** —— 推文、博客、播客的链接都照常给模型。
const extraItems = data.extra?.items || [];
if (extraItems.length) {
  out.push('\n## 补充源条目（可在正文中用 [E<编号>] 引用）');
  out.push('这些是 AINews、Import AI 和各家官方博客当期的条目 —— 一天几十条，');
  out.push('**只给编号和标题，故意不给 URL**：条数一多，模型很容易把标题和链接配错。');
  out.push('你只要写 [E12] 这样的编号，脚本会按编号配回真链接。全部条目都会由脚本');
  out.push('列在简报末尾，所以不必逐条罗列，只在正文确实用得上时引用。');
  out.push('（**这条只管这一节。**上面推文、博客、播客里给出的链接都是内容，照抄照用；');
  out.push('博客正文里的 [文字](URL) 尤其别丢，那是文章自己引用的东西。）');
  out.push('');
  let lastKey = null;
  extraItems.forEach((it, i) => {
    const path = [it.section, it.subsection, it.topic].filter(Boolean).join(' › ');
    const key = it.source + (path ? ' 【' + path + '】' : '');
    if (key !== lastKey) {
      out.push(`\n**${key}**`);
      lastKey = key;
    }
    out.push(`[E${i + 1}] <${it.source}> ${it.title}` + (it.summary ? ` —— ${it.summary}` : ''));
  });
}

// 上游那四段改写指令（summarize_tweets / summarize_blogs / summarize_podcast /
// digest_intro）曾经原样拼在这里，占素材的 19%（6280 字符），而且逐日一字不变。
// 它们是为「英文 digest 发到 Telegram」写的，和本项目的 digest-style.md 正面冲突：
// 要求开头写 "AI Builders Digest — [Date]"（我们要 frontmatter）、每人 2-4 句
// （我们要 ### 标题 + 段落）、还让模型在末尾加一行英文出处 —— 那行确实漏进了
// 08-23 到 08-26 每一期的正文。
// 其中真正有用的几条（署名规则、必引原话、无链接不收录、不臆测）已经并进
// digest-style.md，此后不再每天重发。

const text = out.join('\n');
console.error(`[extract] ${issue}：原始 JSON ${(JSON.stringify(data).length / 1024).toFixed(0)}KB → 素材 ${(text.length / 1024).toFixed(0)}KB`);
console.log(text);
