#!/usr/bin/env node

// ============================================================================
// 把补充源的内容并进当期简报
// ============================================================================
// 两件事：
//   1. 把模型写的 [E12] 引用编号替换成真链接
//   2. 在简报末尾追加/更新「延伸阅读」一节，列出本期全部补充条目
//
// **URL 只来自 digests/raw/<期号>.json，不来自模型。** 模型全程只见过编号和标题，
// 所以它不可能编造链接；编号写错也只会退化成纯文本，不会产生死链。
//
// 幂等：用 <!-- EXTRA:START/END --> 标记包裹，重复运行是替换不是追加。
//
// 用法: node scripts/link-digest.js <期号>
// ============================================================================

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { GROUPS, groupOf } from './groups.js';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const issue = process.argv[2];
if (!issue) {
  console.error('用法: node scripts/link-digest.js <期号，如 2026-08-24>');
  process.exit(1);
}

const START = '<!-- EXTRA:START -->';
const END = '<!-- EXTRA:END -->';


// 域名去掉 www，用作「出处」标签
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

// 一个条目一行：标题 + 出处标签 + 描述。描述用 ⟪⟫ 包起来，渲染器会把它
// 变成条目内部的一段，而不是独立的引用块 —— 这样标题和描述在视觉上属于同一块，
// 整块都能点。中英两个视图用同一套结构。
function itemLine(item, n, opts) {
  const L = localized(item, n);
  const extra = (item.links || []).map(l => ` · [${esc(linkLabel(l.url, l.text))}](${escUrl(l.url)})`).join('');
  const desc = (opts?.context !== false && L.summary)
    ? ` ⟪${esc(String(L.summary).replace(/^PLUS:\s*/i, opts?.altLabel || ''))}⟫` : '';
  return `- [${esc(L.title)}](${escUrl(item.url)})${extra}${desc}`;
}

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

// 「另一来源」看不出会跳到哪去。改成从 URL 推断目的地：
// 推文显示 @handle，其他显示域名 —— 点之前就知道要去哪。
function linkLabel(url, text) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (/^(x|twitter)\.com$/.test(host)) {
      const h = u.pathname.split('/').filter(Boolean)[0];
      if (h && h !== 'i') return '@' + h;
      return 'x.com';
    }
    if (host === 'github.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      return parts.length >= 2 ? `GitHub/${parts[1]}` : 'GitHub';
    }
    return host;
  } catch {
    const at = /@[A-Za-z0-9_]+/.exec(text || '');
    return at ? at[0] : '原文';
  }
}

// 链接文字里的方括号会破坏 markdown 链接语法，换成圆括号（[Paper] → (Paper)）
const esc = s => (s || '').replace(/\[/g, '(').replace(/\]/g, ')');
// URL 里的圆括号同样会提前闭合 (…)，做百分号编码
const escUrl = s => (s || '').replace(/\(/g, '%28').replace(/\)/g, '%29');

// ── 读数据 ────────────────────────────────────────────────────────────────

const mdPath = join(ROOT, 'digests', `${issue}.md`);
const rawPath = join(ROOT, 'digests/raw', `${issue}.json`);

if (!existsSync(mdPath)) {
  console.error(`找不到简报: ${mdPath}`);
  process.exit(1);
}
if (!existsSync(rawPath)) {
  console.log(`[link-digest] ${issue}：无原始数据，跳过`);
  process.exit(0);
}

const md = await readFile(mdPath, 'utf-8');
const extra = JSON.parse(await readFile(rawPath, 'utf-8')).extra || { items: [], sources: [] };
const items = extra.items || [];

// Haiku 翻译的中文标题，按编号索引；没有就用英文原标题
let zh = {};
const zhPath = join(ROOT, 'digests/extra-zh', `${issue}.json`);
if (existsSync(zhPath)) {
  try {
    zh = JSON.parse(await readFile(zhPath, 'utf-8'));
  } catch {
    zh = {};   // 翻译文件坏了就退回英文，不影响出稿
  }
}
// 编号错位会静默地把标题配到错误的链接上 —— 这是这套设计唯一的真实风险。
// 所以译文格式带一段英文原标题前缀做校验：["Harness design is b", "中文标题"]。
// 对不上就退回英文原标题并计数告警，绝不把可疑译名配上链接。
let mismatched = 0;
// 板块 / 子版块 / 主题这些结构标题的译名。中文版是英文版的提炼，
// 层级标题也该是中文；查不到就用原文，不猜。
const sectionZh = name => (zh.sections && zh.sections[name]) || name;

// 返回 { title, summary } —— 校验不过就整条退回英文，绝不半中半英
function localized(item, n) {
  const en = { title: item.title, summary: item.summary };
  const v = zh[String(n)];
  if (!v) return en;
  if (typeof v === 'string') return { title: v, summary: item.summary };  // 老格式
  if (!Array.isArray(v) || v.length < 2) return en;
  const [prefix, title, summary] = v;
  if (!prefix || !item.title.startsWith(String(prefix).slice(0, 18))) {
    mismatched++;
    return en;
  }
  return { title: title || item.title, summary: summary || item.summary };
}

if (!items.length) {
  console.log(`[link-digest] ${issue}：本期无补充条目`);
  process.exit(0);
}

// ── 1. 替换正文里的引用编号 ────────────────────────────────────────────────

let body = md;
let cited = 0;
const bogus = [];

// 先剥掉旧的延伸阅读节，避免在里面做替换
const oldStart = body.indexOf(START);
if (oldStart !== -1) {
  const oldEnd = body.indexOf(END);
  body = body.slice(0, oldStart).replace(/\n+$/, '\n') +
         (oldEnd !== -1 ? body.slice(oldEnd + END.length) : '');
}

body = body.replace(/\[E(\d+)\]/g, (whole, n) => {
  const item = items[Number(n) - 1];
  if (!item) {
    bogus.push(whole);
    return '';   // 编号不存在：整个标记去掉，不留死链也不留噪声
  }
  cited++;
  return `（[${esc(titleOf(item, Number(n)))}](${escUrl(item.url)})）`;
});

// ── 2. 生成延伸阅读一节 ────────────────────────────────────────────────────

// 跟着正文已有的板块继续编号（正文是 ## 一、… ## 二、…）
const usedSections = (body.match(/^## [一二三四五六七八九十]、/gm) || []).length;
const numeral = NUMERALS[usedSections] || String(usedSections + 1);

// 模型判定与 AI 无关的条目在这里剔除
const dropped = new Set((zh.drop || []).map(Number));
const kept = items.map((item, i) => ({ item, n: i + 1 })).filter(x => !dropped.has(x.n));

const byGroup = new Map(GROUPS.map(g => [g.name, []]));
for (const x of kept) byGroup.get(groupOf(x.item.source).name).push(x);

const lines = [START, '', `## ${numeral}、延伸阅读`, '',
  '> 标题、链接和描述均由脚本直接从原文提取，非改写；中文为译文。',
  '> 整条可点击跳转。与 AI 无关的条目已剔除。', ''];

// 采集了多少、中文留下多少，按组摊开 —— 剔除是模型做的判断，
// 数字摆在最显眼处才知道它剔了多少、剔在哪一组。
const collected = new Map(GROUPS.map(g => [g.name, 0]));
for (const item of items) {
  const k = groupOf(item.source).name;
  collected.set(k, collected.get(k) + 1);
}
const parts = GROUPS
  .filter(g => collected.get(g.name) > 0)
  .map(g => `${esc(g.name)} ⟨${byGroup.get(g.name).length} / ${collected.get(g.name)}⟩`);
if (parts.length) {
  // ⟦ 开头：渲染器会把这一行排成统计条。一律「展示 / 采集」，不再加图例。
  lines.push(`⟦中文展示 ⟨${kept.length} / ${items.length}⟩ 篇：` + parts.join(' · '), '');
}

for (const g of GROUPS) {
  const group = byGroup.get(g.name);
  if (!group.length) continue;
  const src = g.sources[0];

  // 单一来源的组，把官方站点挂在组标题上；AINews 另挂当期汇总
  const home = [...new Set(group.map(x => x.item.sourceHome).filter(Boolean))];
  const issueUrl = group.find(x => x.item.issueUrl)?.item.issueUrl;
  let head = `#### ${g.name} ⟨${group.length} 条⟩`;
  if (issueUrl) head += ` [看当期汇总 ↗](${escUrl(issueUrl)})`;
  else if (!g.subBySource && home.length === 1) head += ` [${esc(hostOf(home[0]))} ↗](${escUrl(home[0])})`;
  lines.push('', head, '');

  // Import AI：期刊本身和它引用的一手来源性质不同，分开排
  if (g.name === 'Import AI') {
    const issueItem = group.find(x => x.item.isIssue);
    const refs = group.filter(x => !x.item.isIssue);
    // 本期是这一组里最重要的东西，给它一个标题层级，大纲里才看得到
    if (issueItem) {
      lines.push(`##### 本期：${esc(localized(issueItem.item, issueItem.n).title)}`, '',
        `- [读全文](${escUrl(issueItem.item.url)})`, '');
    }
    if (refs.length) {
      // 这是一句说明不是一个章节，用普通段落，免得占据大纲一行
      lines.push('**其中引用的一手来源：**', '');
      refs.forEach(({ item, n }) => lines.push(itemLine(item, n)));
      lines.push('');
    }
    continue;
  }

  let lastSub = null, lastSec = null, lastTopic = null;
  for (const { item, n } of group) {
    // 组内细分。官方博客按博客名分，并把该博客的官网挂在小标题上 ——
    // 每篇都是精挑的，出处应当一眼可见。
    if (g.subBySource && item.source !== lastSub) {
      const link = item.sourceHome
        ? ` [${esc(hostOf(item.sourceHome))} ↗](${escUrl(item.sourceHome)})` : '';
      lines.push('', `##### ${item.source}${link}`, '');
      lastSub = item.source;
    }
    // AINews 是三层：板块 → 子版块 → 主题。早先把后两层拼成一个字符串，
    // 结果子版块名在每个主题里重复一遍。现在各占各的层级。
    if (g.subBySection) {
      if (item.section && item.section !== lastSec) {
        lines.push('', `##### ${esc(sectionZh(item.section))}`, '');
        lastSec = item.section; lastSub = null; lastTopic = null;
      }
      if (item.subsection && item.subsection !== lastSub) {
        lines.push('', `###### ${esc(sectionZh(item.subsection))}`, '');
        lastSub = item.subsection; lastTopic = null;
      }
      if (item.topic && item.topic !== lastTopic) {
        lines.push('', `**${esc(sectionZh(item.topic))}**`, '');
        lastTopic = item.topic;
      }
    }
    lines.push(itemLine(item, n, {
      context: g.context,
      altLabel: src === 'The Rundown AI' ? '另讯：' : ''
    }));
  }
  lines.push('');
}

// 抓失败的源要明说，不能静悄悄少一块
const failed = (extra.sources || []).filter(s => s.status === 'error');
if (failed.length) {
  lines.push(`> ⚠️ 本期以下信息源抓取失败：${failed.map(f => `${f.name}（${f.error}）`).join('；')}`, '');
}

lines.push(END, '');

// ── 3. 写回 ───────────────────────────────────────────────────────────────

const out = body.replace(/\n+$/, '\n') + '\n' + lines.join('\n');
await writeFile(mdPath, out);

console.log(`[link-digest] ${issue}：${items.length} 条补充条目` +
  (dropped.size ? `（剔除无关 ${dropped.size} 条，保留 ${kept.length}）` : '') +
  `，正文引用 ${cited} 处` +
  (bogus.length ? `，⚠️ 无效编号 ${bogus.length} 个已移除：${bogus.join(' ')}` : '') +
  (Object.keys(zh).length ? '，标题用中文译名' : '，标题用英文原文') +
  (mismatched ? `，⚠️ ${mismatched} 条译文与原标题对不上，已退回英文` : ''));
