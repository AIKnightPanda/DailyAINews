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

import { sourceById, ALL_SOURCES, CATEGORY_ORDER, CATEGORY_LABEL, CATEGORY_LABEL_EN } from '../idea-sources.js';

// category 是注册表里的静态属性，按 sourceId 现查，不落进 raw JSON ——
// 这样旧期号加新维度不用回填数据，直接重新渲染就对齐了
const categoryOf = it => sourceById(it.sourceId)?.category || 'idea';
// 粗略的热度分：points/thumbsUp 权重给足，views 打个折 —— 只用来在同一个
// 来源内部排序，不展示给读者，所以不用多精确，能把明显更热的顶上去就够了
const engagementOf = it => {
  const g = it.signal || {};
  return (g.points || 0) * 2 + (g.thumbsUp || 0) * 2 + Math.floor((g.views || 0) / 20);
};

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

// 星标是第四个可选元素（[探针, 标题, 说明, 星标?]），逐条由模型判断内容本身
// 值不值得多看一眼 —— 不是按来源判断。见 ideas-style.md「星标」一节。
const starOf = (item, zh) => !!(rowOf(item, zh) || [])[3];

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
// 砍到两栏。六栏那版把「值不值得做」拆成四道单独打勾的门槛，读起来像审计
// 报告，而且检查表本身会跑偏——2026-09-04 又一次改版是因为读者指出：
// 「值不值得做，是对这个点子或产品本身的判断，而不是去看是否有这几个
// 元素，这是舍本逐末」。所以这里要的从来不是「过了几道检查」，
// 是「这是什么」加「我怎么判断它本身有没有价值」。
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
  // 2026-09-04 第四次改版：这一节的标题从「值得做的」改叫「精选」——
  // 「值得做」是判断本身的措辞，留在下面的判断文字里就够了，标题只需要
  // 说清「这是我们从今天的候选里挑出来的」。
  const out = [PICKS_START, '', `## ${lang === 'en' ? 'Featured' : '精选'}`, ''];

  if (!list.length) {
    // 空是一个正常且诚实的结果，不是故障。但要让读者能分辨这两者，
    // 所以把「读过多少条」一起说出来 —— 读过一堆却一条没选，是选的人严格；
    // 一条都没读过，那才是管道断了。
    const read = data.items.filter(x => x.candidate).length;
    out.push(lang === 'en'
      ? `> Nothing looked worth building today (${read} items read in full).`
      : `> **今天没有值得做的。** 读完了 ${read} 条候选，没有一条本身的价值大到值得单独拎出来。下面的库里都读过了，可以自己翻。`,
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
// 2026-09-04 第三次改版：上一版是「点子/产品（h3）→ 条目」一层，
// 但外面还包了一层「完整库」标题——读者反馈「点子」「产品」这两个才是真正
// 的分类，「完整库」只是个容器，不该比它们还显眼。所以「完整库」这层
// 整个去掉，点子/产品直接是本节最高一级；节内再按**来源**分小节
// （之前是不分的一整条列表），每个来源标题下面顺带报「抓了几条、
// 展示了几条」，读者不用再去别处对统计。来源顺序照 idea-sources.js
// 里的注册表顺序走——各来源的条目已经天然聚在一起了，不需要再靠
// 「优质来源永远置顶」这种规则去调顺序（那是上一版的 featured，已删）。

function restRowOf(it, zh, lang) {
  const t = textOf(it, zh, lang);
  // 中文是模型写的一句话说明，本来就短，裁到 220 字是为了跟 zh 一句话的
  // 篇幅对齐，不算裁剪。英文视图是核查页——2026-09-05 读者发现这里之前
  // 拿 it.summary（一阶段 600 字预筛摘要，还不是深挖后的正文）又裁到
  // 220 字，两层裁剪叠在一起，「Custom AI brain games」这条被砍在
  // "out of the" 半句上。现在英文视图改用深挖后的完整正文（没有就退到
  // summary），也不再二次裁剪——核查页要看得到完整原文。
  const desc = lang === 'en' ? ((it.deep && it.deep.body) || it.summary || '') : t.summary;
  if (!desc || String(desc).trim().length <= 8) return null;   // 说不出来就不展示
  return {
    title: lang === 'en' ? String(t.title) : String(t.title).slice(0, 90),
    desc: lang === 'en' ? String(desc) : String(desc).slice(0, 220),
    url: it.url,
    source: it.source,
    signal: signalText(it),
    star: starOf(it, zh),
    engagement: engagementOf(it)   // 只用来排序，下面排完就丢掉
  };
}

// 页面用：结构化的行，由 template.html 排版。
// 走结构化而不是 markdown bullet，是因为「标题 + 说明 + 来源 + 信号」四样东西
// 塞进一个 li 里怎么排都别扭，交给 CSS 才排得开。
//
// 两层分组：类别（点子/产品）→ 来源。每个来源都报「抓了多少、展示了多少」，
// 而且**只要这个来源今天抓到过东西就要列出来**，哪怕一条都没展示——
// 「抓了 17 条、展示 0 条」和「今天没抓这个来源」是两件不同的事，
// 前者要老实报出来，不能因为展示数是 0 就悄悄不提这个来源。
// 只有今天确实一条都没抓到的来源（比如按周跑的源赶上非发布周）才跳过，
// 那不是「展示为 0」，是「今天没有它的数据」，没什么好报的。
export function restRows(data, zh, picks, lang) {
  const picked = new Set(resolvePicks(data, picks).list.map(x => x.it.ref));
  // picks.exclude：模型确认读完之后判断「纯讨论、跟点子/产品无关」的编号——
  // 跟 picks.drop 是两回事，drop 只是「没选进值得做」，excluded 的这些
  // 连库里都不该出现（评论区讨论 Claude 是不是变差了、怎么在 Ask HN 提问
  // 这类，不是产品需求，2026-09-05 读者反馈这类不该展示）。
  //
  // 只在中文视图生效——英文视图是核对原始信息用的核查页，本来就该展示
  // 读过的全部内容，不该被「是否相关」这种主观判断再筛一遍。exclude
  // 挡的是模型的编辑判断，不是原始材料本身，读者要能在英文视图里
  // 看到我筛掉的到底是什么，才有得核对。
  const excluded = lang === 'en' ? new Set() : new Set(picks?.exclude || []);
  const CL = lang === 'en' ? CATEGORY_LABEL_EN : CATEGORY_LABEL;

  // 池子里深挖过的候选，加上风向类源（不进池子，但有模型写的摘要）—— 两边
  // 都要落进 点子/产品 这两个抽屉之一，不再单独开一个「风向」平级分组
  const skip = ref => picked.has(ref) || excluded.has(ref);
  const pool = data.items.filter(x => x.candidate && !skip(x.ref));
  const extra = data.items.filter(x => !x.pool && x.summary && !skip(x.ref));
  const items = [...pool, ...extra];

  const groups = [];
  for (const key of CATEGORY_ORDER) {
    const bucket = items.filter(x => categoryOf(x) === key);

    const subs = [];
    for (const src of ALL_SOURCES) {
      if ((src.category || 'idea') !== key) continue;
      const fetched = data.items.filter(x => x.sourceId === src.id).length;
      if (!fetched) continue;   // 今天没抓到这个来源的数据，不是「展示为 0」，不用报
      const rows = bucket.filter(x => x.sourceId === src.id)
        .map(it => restRowOf(it, zh, lang)).filter(Boolean)
        .sort((a, b) => (b.star - a.star) || (b.engagement - a.engagement))
        .map(({ engagement, ...r }) => r);
      subs.push({ source: src.name, fetched, shown: rows.length, rows });
    }
    const fetched = subs.reduce((n, s) => n + s.fetched, 0);
    const shown = subs.reduce((n, s) => n + s.shown, 0);
    groups.push({ key, label: CL[key], fetched, shown, subs });
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
// 层级和页面一致：类别（点子/产品）在 h2，和上面的「精选」平级；来源在 h3。
export function renderRunnerUps(data, zh, picks, lang) {
  const groups = restRows(data, zh, picks, lang);
  if (!groups.length) return [];

  const out = [];
  for (const g of groups) {
    out.push(`## ${g.label}（展示 ${g.shown}/${g.fetched} 条）`, '');
    for (const s of g.subs) {
      out.push(`### ${s.source}（展示 ${s.shown}/${s.fetched} 条）`, '');
      for (const r of s.rows) {
        out.push(`- **[${esc(r.title)}](${escUrl(r.url)})**` + (r.star ? ' ⭐' : '') +
          (r.signal ? `　<sub>${esc(r.signal)}</sub>` : ''));
        out.push(`  ${esc(r.desc)}`);
      }
      out.push('');
    }
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
