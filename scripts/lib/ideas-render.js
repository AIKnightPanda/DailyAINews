// ============================================================================
// 灵感条目的版式 —— 中英共用的唯一真相源
// ============================================================================
// 中文由 link-ideas.js 排成 ideas/<期号>.md，
// 英文由 build-ideas-viewer.js 排成 docs/ideas-source/<期号>.json 的 bodyEn。
// 两边调同一组函数，只是 lang 不同 —— 版式不可能各自漂移。
//
// 译文只影响**文字**，链接永远从 raw 里取。所以译文错位最坏是标题挂错，
// 不会产生死链；而错位本身由探针挡住。
// ============================================================================

import { sourceById, CATEGORY_ORDER, CATEGORY_LABEL, CATEGORY_LABEL_EN } from '../idea-sources.js';

// category/featured 都是注册表里的静态属性，按 sourceId 现查，
// 不落进 raw JSON —— 这样旧期号加新维度不用回填数据，直接重新渲染就对齐了
const categoryOf = it => sourceById(it.sourceId)?.category || 'idea';
const isFeatured = it => !!sourceById(it.sourceId)?.featured;
// 粗略的热度分：points/thumbsUp 权重给足，views 打个折 —— 只用来在类别内部
// 排序，不展示给读者，所以不用多精确，能把明显更热的顶上去就够了
const engagementOf = it => {
  const g = it.signal || {};
  return (g.points || 0) * 2 + (g.thumbsUp || 0) * 2 + Math.floor((g.views || 0) / 20);
};
// 排序规则：featured（优质来源，如 Product Hunt、IdeaBrowser）永远最前，
// 类别内部按热度降序。Array#sort 在现代引擎里是稳定排序，热度打平时保持原序。
const rankSort = list => list.slice().sort((a, b) =>
  ((b.featured ? 1 : 0) - (a.featured ? 1 : 0)) || ((b.engagement || 0) - (a.engagement || 0)));

export const esc = s => String(s || '').replace(/([[\]])/g, '\\$1');
export const escUrl = u => String(u || '').replace(/[()\s]/g, encodeURIComponent);

// 半数以上是中日韩字符就当中文原文，不该再「翻译」一遍
export const isCJK = t => {
  const s = String(t || '');
  if (!s) return false;
  return (s.match(/[一-鿿぀-ヿ]/g) || []).length / s.length > 0.3;
};

// ── 探针：既是校验也是定位 ────────────────────────────────────────────────
// 探针是英文原标题的开头一段（照抄原文）。它最初只是**校验**：编号一旦错位，
// 译文就会静默地挂到另一条链接上。后来发现它还能**定位** —— 探针必须是标题的
// 前缀，所以只可能匹配上内容对得上的那一条，编号退化成提示。
//
// 前缀匹配而不是「前 N 个字符逐字相等」：让模型数准字符数本身就容易出错，
// 而出错的代价是一条本来没问题的译文被判死。
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
// 探针要够独特，否则短前缀会撞上一片条目。例外是产品名本身就短
// （Folio、nOS4），整条等于标题时不存在「不够独特」的问题。
const PROBE_MIN = 10;
const probeFits = (p, title) => p.length >= PROBE_MIN || p === norm(title);

// 把 zh 文件解析成 ref → 译文 的映射。先认编号（快路径），编号对不上就靠探针找，
// 但**只在唯一命中时才认** —— 有歧义宁可不翻，也不能挂错。
export function resolveZh(data, zh) {
  const out = new Map();
  const stat = { byRef: 0, byProbe: 0, ambiguous: 0, orphan: 0 };
  if (!zh) return { map: out, stat };

  const byRef = new Map(data.items.map(x => [x.ref, x]));
  const taken = new Set();
  const pending = [];

  for (const [key, row] of Object.entries(zh)) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const p = norm(row[0]);
    if (!p) { stat.orphan++; continue; }
    const hit = byRef.get(key);
    if (hit && probeFits(p, hit.title) && norm(hit.title).startsWith(p)) {
      out.set(hit.ref, row); taken.add(hit.ref); stat.byRef++;
    } else {
      pending.push({ p, row });
    }
  }

  for (const { p, row } of pending) {
    const hits = data.items.filter(x =>
      !taken.has(x.ref) && probeFits(p, x.title) && norm(x.title).startsWith(p));
    if (hits.length === 1) { out.set(hits[0].ref, row); taken.add(hits[0].ref); stat.byProbe++; }
    else if (hits.length > 1) stat.ambiguous++;   // 分不清是哪条，宁可不翻
    else stat.orphan++;                          // 素材里没有这条
  }
  return { map: out, stat };
}

// 精选也要过探针，理由和译文一样、后果更重：译文错位是标题挂错，
// 精选错位是**整段判断挂到另一条帖子上**，还会写进期号索引的摘要。
// 2026-09-02 实测发生过一次，页面上毫无异样。对不上就整条丢掉并喊出来。
export function resolvePicks(data, picks) {
  const byRef = new Map(data.items.map(x => [x.ref, x]));
  const list = [];
  const rejected = [];
  for (const p of picks?.picks || []) {
    let it = byRef.get(p.ref);
    if (p.t) {
      const q = norm(p.t);
      if (!it || !probeFits(q, it.title) || !norm(it.title).startsWith(q)) {
        const hits = data.items.filter(x => probeFits(q, x.title) && norm(x.title).startsWith(q));
        it = hits.length === 1 ? hits[0] : null;
      }
    }
    if (it) list.push({ p, it });
    else rejected.push(p.ref + (p.t ? `（${String(p.t).slice(0, 30)}）` : ''));
  }
  return { list, rejected };
}

const rowOf = (item, zh) => {
  if (!zh) return null;
  if (zh instanceof Map) return zh.get(item.ref) || null;
  const row = zh[item.ref];
  if (!Array.isArray(row)) return null;
  const p = norm(row[0]);
  return probeFits(p, item.title) && norm(item.title).startsWith(p) ? row : null;
};

export const textOf = (item, zh, lang) => {
  if (lang === 'en') return { title: item.title, summary: item.summary, ok: true };
  if (isCJK(item.title)) return { title: item.title, summary: item.summary, ok: true };
  const row = rowOf(item, zh);
  if (!row) return { title: item.title, summary: item.summary, ok: false };
  return { title: row[1] || item.title, summary: row[2] || item.summary, ok: true };
};

// ── 今日精选 ──────────────────────────────────────────────────────────────
// 页面上这一块由 template.html 渲染成卡片，两处都出就重复了，
// 所以 md 里用标记包起来，build-ideas-viewer.js 送进页面前按标记剪掉。
// md 文件本身保持自包含 —— 在 GitHub 上直接看仍然是完整的一期。
export const PICKS_START = '<!-- PICKS:START -->';
export const PICKS_END = '<!-- PICKS:END -->';

export const dots = n => '●'.repeat(Math.max(0, Math.min(5, n | 0))) + '○'.repeat(Math.max(0, 5 - (n | 0)));

// 2026-09-04 从六栏（是什么/谁在要/钱在哪里/已有方案/怎么找到人/判断）
// 砍到两栏。六栏那版是把「值不值得做」的四道判断门槛（需求具体/一人可做/
// 有人已经在花钱/找得到这些人）每一条都摊成一个字段，读起来像审计报告，
// 而这里要的其实只是「这是什么」加「我怎么判断」——四道门槛还在，只是
// 收进了模型判断时的内部标准，不必每条都单独写出来给读者看。
//
// 读者要知道的只有两件事：
//   background —— 这是什么：用户是谁、他的问题/需求是什么、别人（评论区）
//                 怎么反馈的，柔性地写成一小段话，哪样信息不够就不写那句，
//                 不为了凑够「用户/需求/反馈」三件套硬编。
//   verdict    —— 我的判断：值不值得做，为什么。
// 「来源」不用写进文字里，标题下面已经有来源角标（点子/产品 + 具体来源名）。
const FIELDS = [
  ['background', '背景'],
  ['verdict', '判断']
];

export function renderPicks(data, zh, picks, lang) {
  const { list } = resolvePicks(data, picks);
  const out = [PICKS_START, '', `## ${lang === 'en' ? 'Worth building' : '值得做的'}`, ''];

  if (!list.length) {
    // 空是一个正常且诚实的结果，不是故障。但要让读者能分辨这两者，
    // 所以把「读过多少条」一起说出来 —— 读过一堆却一条没选，是选的人严格；
    // 一条都没读过，那才是管道断了。
    const read = data.items.filter(x => x.candidate).length;
    out.push(lang === 'en'
      ? `> Nothing cleared the bar today (${read} items read in full).`
      : `> **今天没有值得做的。** 读完了 ${read} 条候选，没有一条同时满足四道门槛` +
        `（需求具体 / 一个人做得完 / 有人已经在花钱 / 你找得到这些人）。` +
        `下面的库里都读过了，可以自己翻。`,
      '', PICKS_END, '');
    return out;
  }

  const CL = lang === 'en' ? CATEGORY_LABEL_EN : CATEGORY_LABEL;

  list.forEach(({ p, it }, i) => {
    const t = textOf(it, zh, lang);
    const head = lang === 'en' ? t.title : (p.title || t.title);
    out.push(`### ${i + 1}. ${esc(head)}`, '');
    out.push([
      CL[categoryOf(it)] || null,
      `[${esc(it.source)}](${escUrl(it.url)})`,
      p.score != null ? `**值得做** ${dots(p.score)}` : null
    ].filter(Boolean).join(' · '), '');

    if (lang === 'en') {
      const raw = it.deep?.body || it.summary;
      if (raw) out.push(`> ${esc(String(raw).slice(0, 700))}`, '');
      return;   // forEach 回调里是 return 不是 continue
    }

    for (const [k, label] of FIELDS) {
      if (p[k]) out.push(`**${label}**：${esc(p[k])}`, '');
    }
  });

  out.push(PICKS_END, '');
  return out;
}

// ── 完整库 ────────────────────────────────────────────────────────────────
// 规矩：**页面上不出现没被读懂的条目。**
// 只列有一句话说明的（模型在任务 A 里写的）。一条叫「Doop」或「Hey guys」的标题
// 读者看了等于没看。池子里剩下多少条会在末尾报个数字，不会静悄悄消失。
//
// 2026-09-04 第二次改版：上一版把这一节叫「其余读过的」，内部按「谁的视角」
// 分两栏、栏内再拆需求/供给两个子节——四层结构，读者反馈「这版结构不合理，
// 而且非常有歧义」：「其余读过的」本身不该是一个类别，它只是「值得做」之外
// 的库存；真正该分类的维度是**做没做出来**，不是「谁的视角」。
// 所以砍成一层：点子（还没做出来的）、产品（已经做出来的，不论规模），
// 没有第三个类别，风向类的源也要落进这两个之一（见 idea-sources.js 的注释）。

function restRowOf(it, zh, lang) {
  const t = textOf(it, zh, lang);
  const desc = lang === 'en' ? it.summary : t.summary;
  if (!desc || String(desc).trim().length <= 8) return null;   // 说不出来就不展示
  return {
    title: String(t.title).slice(0, 90),
    desc: String(desc).slice(0, 220),
    url: it.url,
    source: it.source,
    signal: signalText(it),
    featured: isFeatured(it),
    engagement: engagementOf(it)   // 只用来排序，下面 rankSort 完就丢掉
  };
}

// 页面用：结构化的行，由 template.html 排版。
// 走结构化而不是 markdown bullet，是因为「标题 + 说明 + 来源 + 信号」四样东西
// 塞进一个 li 里怎么排都别扭，交给 CSS 才排得开。
export function restRows(data, zh, picks, lang) {
  const picked = new Set(resolvePicks(data, picks).list.map(x => x.it.ref));
  const CL = lang === 'en' ? CATEGORY_LABEL_EN : CATEGORY_LABEL;

  // 池子里深挖过的候选，加上风向类源（不进池子，但有模型写的摘要）—— 两边
  // 都要落进 点子/产品 这两个抽屉之一，不再单独开一个「风向」平级分组
  const pool = data.items.filter(x => x.candidate && !picked.has(x.ref));
  const extra = data.items.filter(x => !x.pool && x.summary && !picked.has(x.ref));
  const items = [...pool, ...extra];

  const groups = [];
  for (const key of CATEGORY_ORDER) {
    const bucket = items.filter(x => categoryOf(x) === key);
    const rows = rankSort(bucket.map(it => restRowOf(it, zh, lang)).filter(Boolean))
      .map(({ engagement, ...r }) => r);   // 排完序就不需要这个数了，不进最终 payload
    if (!rows.length) continue;
    const sources = [...new Set(bucket.map(x => x.source).filter(Boolean))];
    groups.push({ key, label: CL[key], sources, rows });
  }
  return groups;
}

function signalText(it) {
  const g = it.signal || {};
  const bits = [];
  if (g.points != null) bits.push(`${g.points} 票`);
  if (g.views != null) bits.push(g.unanswered ? `${g.views} 浏览 · 无人答` : `${g.views} 浏览`);
  if (g.thumbsUp != null) bits.push(`👍 ${g.thumbsUp}`);
  return bits.join(' · ');
}

// md 用：同一份数据排成 markdown，让 ideas/<期号>.md 在 GitHub 上自包含。
// 层级和页面一致：类别（点子/产品）在 h3，条目直接跟在下面 —— 只有一层，
// 不再有需求/供给这个中间层级。
export function renderRunnerUps(data, zh, picks, lang) {
  const groups = restRows(data, zh, picks, lang);
  if (!groups.length) return [];

  const out = [`## ${lang === 'en' ? 'Full library' : '完整库'}`, ''];
  out.push(lang === 'en'
    ? '> Everything read, minus what is already highlighted above. Sorted idea vs product, quality sources first.'
    : '> 都读过了，去掉上面已经在「值得做」里出现过的。按点子/产品分类，优质来源排前面。', '');

  for (const g of groups) {
    out.push(`### ${g.label}（${g.rows.length}）` + (g.sources.length ? ` · ${g.sources.join(' · ')}` : ''), '');
    for (const r of g.rows) {
      out.push(`- **[${esc(r.title)}](${escUrl(r.url)})**` + (r.featured ? ' 🔹' : '') +
        `　<sub>${esc(r.source)}${r.signal ? ' · ' + esc(r.signal) : ''}</sub>`);
      out.push(`  ${esc(r.desc)}`);
    }
    out.push('');
  }

  const hidden = data.items.filter(x => x.pool && !x.candidate).length;
  if (hidden) {
    out.push(lang === 'en'
      ? `> ${hidden} more in the pool ranked below the cutoff and were not read.`
      : `> 池子里另有 ${hidden} 条排名在深挖线以下，没有读过，因此不展示。` +
        `它们仍然存在 \`ideas/raw/${data.issue}.json\` 里。`, '');
  }
  return out;
}

// 页面用：把精选那一节从正文里剪掉（卡片已经渲染过一遍了）
export const stripPicks = md => {
  const a = md.indexOf(PICKS_START);
  const b = md.indexOf(PICKS_END);
  if (a === -1 || b === -1) return md;
  return (md.slice(0, a) + md.slice(b + PICKS_END.length)).replace(/^\n+/, '');
};

// ── 失败要看得见 ──────────────────────────────────────────────────────────
// 「安静的一天」和「管道断了」在页面上不能长得一样
export function renderFailures(data) {
  const out = [];
  const failed = (data.sources || []).filter(s => s.status === 'error');
  const partial = (data.sources || []).filter(s => s.status === 'partial');
  if (!data.items.length) {
    out.push(failed.length
      ? `> ⚠️ 本期没有条目，因为 ${failed.length} 个源抓取失败：${failed.map(s => s.name).join('、')}。这是抓取层的问题，不是当天没有内容。`
      : '> 本期各源均正常，但没有新增条目 —— 当天没发新东西，或发的此前已收录。');
  } else if (failed.length) {
    out.push('', `> ⚠️ 有 ${failed.length} 个源抓取失败，本期缺了它们的条目：` +
      failed.map(s => `**${s.name}**（${s.error}）`).join('；'));
  }
  if (partial.length) {
    out.push('', `> ⚠️ ${partial.length} 个源只抓到一部分：` +
      partial.map(s => `**${s.name}**（${s.error}）`).join('；'));
  }
  for (const e of data.errors || []) out.push('', `> ⚠️ ${e}`);
  return out;
}
