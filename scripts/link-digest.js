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
const raw = JSON.parse(await readFile(rawPath, 'utf-8'));
const extra = raw.extra || { items: [], sources: [] };
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

// 模型照抄前缀时，弯引号 ’ 常被抄成直引号 '，破折号和省略号同理。
// 这类字形差异不代表编号错位，不该触发退回英文 —— 比对前先抹平。
// （2026-08-27 那期 "Expanding OpenAI’s presence in Brazil" 就是这么退回英文的。）
const flat = s => String(s)
  .replace(/[\u2018\u2019\u02BC]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\u2026/g, '...')
  .replace(/\u00A0/g, ' ');

// 返回 { title, summary } —— 校验不过就整条退回英文，绝不半中半英
function localized(item, n) {
  const en = { title: item.title, summary: item.summary };
  const v = zh[String(n)];
  if (!v) return en;
  if (typeof v === 'string') return { title: v, summary: item.summary };  // 老格式
  if (!Array.isArray(v) || v.length < 2) return en;
  const [prefix, title, summary] = v;
  // 探针是「英文原标题的开头 18 个字符」。素材里每条形如 `标题 —— 背景说明`，
  // 标题不足 18 字符时，模型抄的 18 个字符会跨过分隔符把说明也带进来 ——
  // 2026-09-04 那期 AINews 标题短到只有「63% on ARC-AGI-3」，10 条全栽在这。
  // 分隔符是我们自己拼的格式，绝不会出现在标题里，按它截断就对齐了。
  const probe = flat(String(prefix)).split('——')[0].trim();
  // 标题比 18 字符还短就拿整个标题比 —— 那反而是更强的校验，不是放水
  const need = Math.min(18, flat(item.title).length);
  if (!probe || !flat(item.title).startsWith(probe.slice(0, need))) {
    mismatched++;
    return en;
  }
  return { title: title || item.title, summary: summary || item.summary };
}

// 这里以前有个「一条都没有就直接 exit」的早退。它出过两次事：
// 2026-08-26 五个源全 403，2026-08-27 预抓文件是空的 —— 两次都是整节凭空消失，
// 页面上和「今天真的没新内容」长得一模一样。现在不退了，一条都没有也把这一节
// 写出来，让它自己说清楚是哪种情况（下面「一条都没有时」那段）。
const failedSources = (extra.sources || []).filter(s => s.status === 'error');

// ── 1. 替换正文里的引用编号 ────────────────────────────────────────────────

let body = md;
let cited = 0;
let tweetStrip = '';
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
  return `（[${esc(localized(item, Number(n)).title)}](${escUrl(item.url)})）`;
});

// ── 1.5 推文板块的采集/展示统计条 ──────────────────────────────────────────
// 和延伸阅读那条统计条同一套路数：数字由脚本算，不让模型自己数 —— 模型数不准，
// 而这里每个数都是能精确算的。口径统一为「展示 / 采集」。
// 「展示」= 正文里出现过原推 URL 的条数；正文展开和「其他从略」清单分开计。
{
  const tweets = [];
  for (const a of raw.x || []) for (const t of a.tweets || []) {
    if (t.url) tweets.push({ url: t.url, author: a.name || a.handle });
  }
  const head = /^##\s+.*(?:X \/ Twitter|推文).*$/m.exec(body);
  if (tweets.length && head) {
    // 幂等：先撕掉上一次插进去的那条
    body = body.replace(/^⟦推文展示[^\n]*\n\n?/m, '');
    const start = body.indexOf(head[0]) + head[0].length;
    const seg = body.slice(start);
    const cut = seg.search(/^###\s+其他从略/m);          // 从略清单的分界线
    const inMain = cut === -1 ? seg : seg.slice(0, cut);
    const inList = cut === -1 ? '' : seg.slice(cut);

    let main = 0, list = 0;
    const authors = new Set();
    for (const t of tweets) {
      const where = inMain.includes(t.url) ? 'main' : inList.includes(t.url) ? 'list' : null;
      if (!where) continue;
      if (where === 'main') main++; else list++;
      authors.add(t.author);
    }
    const builders = new Set(tweets.map(t => t.author)).size;
    const strip = `⟦推文展示 ⟨${main + list} / ${tweets.length}⟩ 条：正文展开 ⟨${main}⟩` +
      (cut === -1 ? '' : ` · 其他从略 ⟨${list}⟩`) +
      ` · 覆盖建造者 ⟨${authors.size} / ${builders}⟩ 位`;
    body = body.slice(0, start) + '\n\n' + strip + '\n' + body.slice(start).replace(/^\n+/, '\n');
    tweetStrip = strip;
  }
}

// ── 2. 生成延伸阅读一节 ────────────────────────────────────────────────────

// 跟着正文已有的板块继续编号（正文是 ## 一、… ## 二、…）
const usedSections = (body.match(/^## [一二三四五六七八九十]、/gm) || []).length;
const numeral = NUMERALS[usedSections] || String(usedSections + 1);

// 模型判定与 AI 无关的条目在这里剔除
const dropped = new Set((zh.drop || []).map(Number));
const kept = items.map((item, i) => ({ item, n: i + 1 })).filter(x => !dropped.has(x.n));

const byGroup = new Map(GROUPS.map(g => [g.name, []]));
for (const x of kept) byGroup.get(groupOf(x.item.source).name).push(x);

const lines = [START, '', `## ${numeral}、延伸阅读`, ''];

// 一条都没有时（全员抓取失败）不写这段说明 —— 没有条目，说明取舍规则纯属废话
if (kept.length) {
  lines.push('> 标题、链接和描述均由脚本直接从原文提取，非改写；中文为译文。',
    '> 整条可点击跳转。与 AI 无关的条目已剔除。', '');
}

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
  else if (home.length === 1) head += ` [${esc(hostOf(home[0]))} ↗](${escUrl(home[0])})`;
  lines.push('', head, '');

  // Import AI：期刊本身和它引用的一手来源性质不同，分开排
  if (g.name === 'Import AI') {
    const issueItem = group.find(x => x.item.isIssue);
    const refs = group.filter(x => !x.item.isIssue);
    // 期刊本身排在最前，加粗以示它是这一期的正主；下面是它引用的一手来源。
    // 和其他条目同款的整行可点，不额外挂「读全文」按钮，也不写一句说明 ——
    // 排在开头又是加粗的，本来就看得出来。
    const rows = [];
    if (issueItem) {
      const t = esc(localized(issueItem.item, issueItem.n).title);
      rows.push(`- [**${t}**](${escUrl(issueItem.item.url)})`);
    }
    refs.forEach(({ item, n }) => rows.push(itemLine(item, n)));
    if (rows.length) lines.push(...rows, '');
    continue;
  }

  let lastSub = null, lastSec = null, lastTopic = null;
  for (const { item, n } of group) {
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

// 一条都没有时，也得说一句「今天确实没有」。空着不写的话，「安静的一天」和
// 「管道断了」在页面上长得一模一样 —— 08-27 那期就是这样：预抓文件是空的，
// 五个源全报 ok，于是整节凭空消失，谁也看不出出了事。
if (!items.length) {
  const total = (extra.sources || []).length;
  lines.push(
    !total
      ? '> ⚠️ 本期**没有执行**补充源抓取' + (extra.error ? `：${extra.error}` : '，原因未记录。')
      : failedSources.length === total
        ? ''   // 全失败的情况下面那段会说，这里不重复
        : `> 本期补充源均正常（${total - failedSources.length}/${total} 个源），但没有新增条目 —— ` +
          '各源当天没发新内容，或发的内容此前已收录。',
    '');
}

// 靠镜像救回来的源也要明说 —— 内容是全的，但主站确实挂着，
// 页面上不讲的话就没人知道该去催谁修。主站恢复后这行自己就没了。
const viaMirror = (extra.sources || []).filter(s => s.via);
if (viaMirror.length) {
  lines.push(...viaMirror.map(s =>
    `> ℹ️ ${s.name} 主站当前不可用（${s.via.because}），本期内容取自镜像 ${hostOf(s.via.url)}。`), '');
}

// 抓失败的源要明说，不能静悄悄少一块
if (failedSources.length) {
  const all = failedSources.length === (extra.sources || []).length;
  lines.push(all
    ? `> ⚠️ 本期补充源**全部抓取失败**（${failedSources.length}/${failedSources.length}），` +
      `所以没有延伸阅读。这是抓取层的问题，不是当天没有内容：` +
      failedSources.map(f => `${f.name}（${f.error}）`).join('；')
    : `> ⚠️ 本期以下信息源抓取失败：${failedSources.map(f => `${f.name}（${f.error}）`).join('；')}`, '');
}

lines.push(END, '');

// ── 3. 结构体检（只报警，不改正文）─────────────────────────────────────────
// 2026-08-29、08-30 两期的播客板块整块没有 `###` 标题，读者不知道在讲哪一集，
// 隔了两天才被发现。这里不替模型补写 —— 补出来的东西未必对；只是喊一声，
// 让 Routine 在汇报里带出去。
const emptySections = [];
{
  const heads = [...body.matchAll(/^##\s+(.+)$/gm)];
  heads.forEach((h, i) => {
    const seg = body.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : body.length);
    if (!/^###\s/m.test(seg)) emptySections.push(h[1].trim());
  });
}

// ── 4. 写回 ───────────────────────────────────────────────────────────────

const out = body.replace(/\n+$/, '\n') + '\n' + lines.join('\n');
await writeFile(mdPath, out);

console.log(`[link-digest] ${issue}：${items.length} 条补充条目` +
  (failedSources.length ? `，⚠️ ${failedSources.length}/${(extra.sources || []).length} 个源抓取失败` : '') +
  (dropped.size ? `（剔除无关 ${dropped.size} 条，保留 ${kept.length}）` : '') +
  `，正文引用 ${cited} 处` +
  (bogus.length ? `，⚠️ 无效编号 ${bogus.length} 个已移除：${bogus.join(' ')}` : '') +
  (Object.keys(zh).length ? '，标题用中文译名' : '，标题用英文原文') +
  (mismatched ? `，⚠️ ${mismatched} 条译文与原标题对不上，已退回英文` : '') +
  (emptySections.length ? `，⚠️ 这些板块下没有任何 ### 条目：${emptySections.join('、')}` : '') +
  (tweetStrip ? `\n[link-digest] ${issue}：${tweetStrip.replace(/[⟦⟨⟩]/g, '')}` : ''));
