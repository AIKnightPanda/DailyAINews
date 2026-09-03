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

import { SIDE_ORDER, SIDE_LABEL, ALL_SOURCES } from '../idea-sources.js';

const SIDE_LABEL_EN = { demand: 'Wanted', supply: 'Shipped', trend: 'Signals' };

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

const signalOf = it => {
  const g = it.signal || {};
  const bits = [];
  if (g.points != null) bits.push(`${g.points} 票`);
  if (g.views != null) bits.push(g.unanswered ? `${g.views} 浏览 · 无人回答` : `${g.views} 浏览`);
  if (g.thumbsUp != null) bits.push(`👍 ${g.thumbsUp}`);
  if (it.alsoFrom?.length) bits.push(`+${it.alsoFrom.length} 处`);
  return bits.length ? ` <sub>${bits.join(' · ')}</sub>` : '';
};

// ── 今日精选 ──────────────────────────────────────────────────────────────
// 页面上这一块由 template.html 渲染成卡片，两处都出就重复了，
// 所以 md 里用标记包起来，build-ideas-viewer.js 送进页面前按标记剪掉。
// md 文件本身保持自包含 —— 在 GitHub 上直接看仍然是完整的一期。
export const PICKS_START = '<!-- PICKS:START -->';
export const PICKS_END = '<!-- PICKS:END -->';

export const dots = n => '●'.repeat(Math.max(0, Math.min(5, n | 0))) + '○'.repeat(Math.max(0, 5 - (n | 0)));

export const KIND = { need: '需求', new: '上新' };

// 只有六栏，而且顺序是有讲究的：
//   是什么 → 谁在要 → **钱在哪里** → 已有方案 → 怎么找到人 → 判断
// 「钱在哪里」和「怎么找到人」是 2026-09-03 补的两道门槛。
// 补它们是因为一条「扫条码查食品召回」通过了前面所有检查却绝对不值得做 ——
// 需求具体、没人做、一个人能做完，但**没有任何人在为它花钱**，获客也只能碰运气。
// 缺口不等于生意。
const FIELDS = [
  ['what', '是什么'],
  ['who', '谁在要'],
  ['paying', '钱在哪里'],
  ['state', '已有方案'],
  ['reach', '怎么找到人'],
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
        `下面的列表里都读过了，可以自己翻。`,
      '', PICKS_END, '');
    return out;
  }

  list.forEach(({ p, it }, i) => {
    const t = textOf(it, zh, lang);
    const head = lang === 'en' ? t.title : (p.title || t.title);
    out.push(`### ${i + 1}. ${esc(head)}`, '');
    out.push([
      KIND[p.kind] || null,
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
    if (p.how) out.push(`<sub>怎么做：${esc(p.how)}</sub>`, '');
  });

  out.push(PICKS_END, '');
  return out;
}

// ── 其余候选 ──────────────────────────────────────────────────────────────
// 规矩：**页面上不出现没被读懂的条目。**
// 只列有一句话说明的（模型在任务 A 里写的）。一条叫「Doop」或「Hey guys」的标题
// 读者看了等于没看。池子里剩下多少条会在末尾报个数字，不会静悄悄消失。

const GROUPS_OF = (data, picked) => ([
  { key: 'need', zh: '还有人在要', en: 'Also wanted',
    items: data.items.filter(x => x.candidate && x.side !== 'supply' && !picked.has(x.ref)) },
  { key: 'new', zh: '今天上新', en: 'Shipped today',
    items: data.items.filter(x => x.candidate && x.side === 'supply' && !picked.has(x.ref)) },
  { key: 'trend', zh: '风向', en: 'Signals',
    items: data.items.filter(x => !x.pool && x.summary && !picked.has(x.ref)) }
]);

// 页面用：结构化的行，由 template.html 排版。
// 走结构化而不是 markdown bullet，是因为「标题 + 说明 + 来源 + 信号」四样东西
// 塞进一个 li 里怎么排都别扭，交给 CSS 才排得开。
export function restRows(data, zh, picks, lang) {
  const picked = new Set(resolvePicks(data, picks).list.map(x => x.it.ref));
  return GROUPS_OF(data, picked).map(g => ({
    key: g.key,
    label: lang === 'en' ? g.en : g.zh,
    rows: g.items.map(it => {
      const t = textOf(it, zh, lang);
      const desc = lang === 'en' ? it.summary : t.summary;
      if (!desc || String(desc).trim().length <= 8) return null;   // 说不出来就不展示
      return {
        title: String(t.title).slice(0, 90),
        desc: String(desc).slice(0, 220),
        url: it.url,
        source: it.source,
        signal: signalText(it)
      };
    }).filter(Boolean)
  })).filter(g => g.rows.length);
}

function signalText(it) {
  const g = it.signal || {};
  const bits = [];
  if (g.points != null) bits.push(`${g.points} 票`);
  if (g.views != null) bits.push(g.unanswered ? `${g.views} 浏览 · 无人答` : `${g.views} 浏览`);
  if (g.thumbsUp != null) bits.push(`👍 ${g.thumbsUp}`);
  return bits.join(' · ');
}

// md 用：同一份数据排成 markdown，让 ideas/<期号>.md 在 GitHub 上自包含
export function renderRunnerUps(data, zh, picks, lang) {
  const groups = restRows(data, zh, picks, lang);
  if (!groups.length) return [];

  const out = [`## ${lang === 'en' ? 'The rest' : '其余读过的'}`, ''];
  out.push(lang === 'en'
    ? '> Read in full, but did not clear the bar.'
    : '> 都读过，但没过「值得做」的门槛。每条带一句说明 —— 只有标题的条目不会出现在这里。', '');

  for (const g of groups) {
    out.push(`#### ${g.label}（${g.rows.length}）`, '');
    for (const r of g.rows) {
      out.push(`- **[${esc(r.title)}](${escUrl(r.url)})**` +
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
