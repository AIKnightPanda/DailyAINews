#!/usr/bin/env node

// ============================================================================
// 组装一期灵感简报 ideas/<期号>.md
// ============================================================================
// **整份 md 由脚本拼装，不经过模型。** 模型只产出两份小 JSON：
//
//   ideas/zh/<期号>.json      译文，按编号索引，形如 {"I12": ["英文前18字","中文标题","中文摘要"]}
//   ideas/picks/<期号>.json   预筛结果，{"picks":[{"ref":"I12","why":…,"mvp":…,"risk":…}]}
//
// 两份都只带编号，**看不到 URL**。链接一律由脚本从 ideas/raw/ 里按编号取。
// 所以模型没有能力编造链接；编号写错只会退化成纯文本或整条退回英文。
//
// 这么设计还有个附带好处：token 消耗不随归档期数增长，和简报那条线一样。
//
// 用法: node scripts/link-ideas.js <期号>
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { renderPicks, renderRunnerUps, renderFailures, textOf, resolveZh, resolvePicks } from './lib/ideas-render.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const issue = process.argv[2];

if (!issue) {
  console.error('用法: node scripts/link-ideas.js <期号>');
  process.exit(1);
}

const rawPath = join(ROOT, 'ideas', 'raw', `${issue}.json`);
if (!existsSync(rawPath)) { console.error(`找不到 ${rawPath}`); process.exit(1); }

const readOptional = p => {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); }
  catch (e) { console.error(`⚠️ ${p} 不是合法 JSON，按缺失处理：${e.message}`); return null; }
};

const data = readOptional(rawPath);
// 两份都可以缺：缺译文就整期英文，缺预筛就没有精选那一节。
// 简报照样出得来 —— 这一步失败不该让当期开天窗。
const zhRaw = readOptional(join(ROOT, 'ideas', 'zh', `${issue}.json`));
const picks = readOptional(join(ROOT, 'ideas', 'picks', `${issue}.json`));

const { map: zh, stat } = resolveZh(data, zhRaw);

const picksLines = renderPicks(data, zh, picks, 'zh');
const listLines = renderRunnerUps(data, zh, picks, 'zh');

// headline 取第一条精选的中文标题 —— 期号索引卡片上显示的就是它。
// 走 resolvePicks 而不是自己按编号找：编号偏移时它会被挡下来，
// 不会像 2026-09-02 那次一样静默写成另一条帖子的标题。
const { list: resolved, rejected } = resolvePicks(data, picks);
// headline 优先用模型写的中文一句话（那是它对这条的概括），
// 没有就退回条目标题的译文
const headline = resolved.length
  ? String(resolved[0].p.title || textOf(resolved[0].it, zh, 'zh').title)
      .replace(/[\r\n]/g, ' ').slice(0, 60)
  : '';

const pool = data.items.filter(x => x.pool);
const counts = {
  pool: pool.length,
  screened: pool.filter(x => x.screen?.keep).length,
  candidates: data.items.filter(x => x.candidate).length
};

const md = [
  '---',
  `issue: ${issue}`,
  'kind: ideas',
  `items: ${data.items.length}`,
  `worth: ${resolved.length}`,
  `pool: ${counts.pool}`,
  `screened: ${counts.screened}`,
  `candidates: ${counts.candidates}`,
  `headline: ${headline}`,
  '---',
  '',
  ...picksLines,
  ...listLines,
  ...renderFailures(data),
  ''
].join('\n');

writeFileSync(join(ROOT, 'ideas', `${issue}.md`), md);

// 只统计**会展示的**条目缺不缺说明。池子里排名靠后的那些本来就不上页面，
// 把它们算进来只会让日志天天报「62 条无译文」，看久了就没人当回事了。
const shown = data.items.filter(x => x.candidate || (!x.pool && x.summary));
const misaligned = shown.filter(x => !zh.has(x.ref) && !/[一-鿿]/.test(x.title)).length;

const notes = [];
if (!zhRaw) notes.push('⚠️ 没有译文，整期用英文原文');
else {
  notes.push(`译文 ${zh.size} 条（编号命中 ${stat.byRef}，靠探针找回 ${stat.byProbe}）`);
  if (stat.ambiguous) notes.push(`⚠️ ${stat.ambiguous} 条探针有歧义，未采用`);
  if (stat.orphan) notes.push(`⚠️ ${stat.orphan} 条译文在素材里找不到对应条目`);
  if (misaligned) notes.push(`⚠️ ${misaligned} 条展示条目没有说明，会露出英文原标题`);
}
if (!picks) notes.push('⚠️ 没有预筛结果，本期没有精选');
else if (rejected.length) notes.push(`⚠️ ${rejected.length} 条与素材对不上，已丢弃：${rejected.join('、')}`);

console.log(`[link-ideas] ${issue}：精选 ${resolved.length} 条，读过 ${counts.candidates} 条，池内 ${counts.pool} 条` +
  (notes.length ? `，${notes.join('；')}` : ''));
