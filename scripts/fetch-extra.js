#!/usr/bin/env node

// ============================================================================
// 抓取补充信息源的「标题 + 链接」
// ============================================================================
// Zara 的 feed 只覆盖 builder 的 X / 博客 / 播客，这个脚本补上新闻聚合和
// 官方博客，产出的是纯粹的链接墙 —— 标题、链接、一句话摘要，不抓正文。
//
// 一条硬规则：**URL 只由脚本传递，绝不经过模型。**
// 模型最多翻译标题，脚本按序号把译文重新配回 URL，所以链接不可能被编造。
//
// 用法: node scripts/fetch-extra.js [--days N] [--no-state]
// 输出: JSON 到 stdout
// ============================================================================

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, 'digests', 'extra-seen.json');

const DAYS = Number((process.argv.find(a => a.startsWith('--days=')) || '').split('=')[1]) || 3;
const useState = !process.argv.includes('--no-state');

// 窗口必须锚在**期号日期**上，不能锚在「现在」。
// 否则 08-24 那期会混进 08-25 的文章，而 08-21 发布的又被挤出去 —— 实际踩过。
// 锚定后同一期号重跑结果也一致。
const anchorArg = (process.argv.find(a => a.startsWith('--until=')) || '').split('=')[1];
const ANCHOR = anchorArg ? Date.parse(anchorArg + 'T23:59:59Z') : Date.now();

const SEEN_CAP = 800;      // 状态文件里保留多少条已见 URL
const PER_SOURCE_CAP = 40; // 单个源单次最多收多少条，防止某天异常刷屏
const TIMEOUT = 20_000;

// 实测 news.smol.ai 会在 TLS 握手阶段直接 RESET 掉带 "(compatible; …)" 的 UA
// （0/3 成功），换成常规浏览器 UA 后 3/3。抓的都是公开 RSS，用标准 UA 即可。
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 背景信息的长度上限。给的是「够不够判断要不要点进去」，不是全文。
const CTX_AINEWS = 260;    // AINews 每条正文中位数 530 字符，截一半够用
const CTX_ARTICLE = 320;   // Import AI 的「Why this matters」段落，信息密度高，多给一点
const MAX_LINKS = 3;       // 单条最多附几个链接（AINews 每条常有 2 个）

// 官方博客的 RSS 摘要常常很短（DeepMind 有时干脆是空的）。
// 这些站点的文章页里有 JSON-LD，其中的 description 通常更长也更具体。
// 只对博客源、且 RSS 摘要偏短时才去抓，一天最多一两个请求。
const ENRICH_BELOW = 130;

async function enrichFromJsonLd(url) {
  try {
    const html = await fetchText(url);
    const m = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    const node = Array.isArray(data) ? data[0] : (data['@graph']?.[0] || data);
    const d = node?.description;
    return typeof d === 'string' && d.trim().length > 20 ? stripTags(d) : null;
  } catch {
    return null;   // 抓不到就用 RSS 那份，不影响出稿
  }
}

const SOURCES = [
  // AINews 自己就是日报，一个窗口里可能套进好几期。只取期号当天那一期，
  // 否则「看当期汇总」指向哪一期就说不清了。
  { id: 'ainews',   name: 'AINews',         kind: 'ainews',  url: 'https://news.smol.ai/rss.xml',
    home: 'https://news.smol.ai/', latestOnly: true },
  { id: 'importai', name: 'Import AI',      kind: 'article', url: 'https://jack-clark.net/feed/',
    home: 'https://jack-clark.net/' },
  { id: 'openai',   name: 'OpenAI',         kind: 'simple',  url: 'https://openai.com/news/rss.xml',
    home: 'https://openai.com/news/', enrich: true },
  { id: 'deepmind', name: 'Google DeepMind',kind: 'simple',  url: 'https://deepmind.google/blog/rss.xml',
    home: 'https://deepmind.google/blog/', enrich: true },
  { id: 'rundown',  name: 'The Rundown AI', kind: 'simple',  url: 'https://www.therundown.ai/feed',
    home: 'https://www.therundown.ai/' }
];

// 订阅、登录、分享这类功能性链接不是内容，过滤掉
const JUNK = /\/(subscribe|unsubscribe|login|signup|account|privacy|terms|cdn-cgi)\b|utm_|\/feed\/?$|substack\.com\/(subscribe|app)|support\./i;

// ── 小工具 ────────────────────────────────────────────────────────────────

const ENT = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d' };
// &amp; 放最后解，否则 &amp;lt; 会被解成 < 而不是 &lt;
const unescape = s => s
  .replace(/&(lt|gt|quot|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo);/g, (_, e) => ENT[e])
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

const stripTags = s => unescape(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
// 破折号开头的残留（Why this matters – …）清掉

const tag = (block, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(block);
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '') : '';
};

// 尽量截在句号处，避免把话砍在半截
function clip(text, max) {
  const t = (text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd() + '…');
}

// 一条目里的所有正文链接，去重、去掉功能性链接
function linksIn(html) {
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = unescape(m[1]);
    if (!/^https?:/.test(url) || JUNK.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, text: stripTags(m[2]) });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

async function fetchOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// 五个源并发抓时偶发 fetch failed，直连却没问题 —— 明显是瞬时抖动。
// 重试一次即可，HTTP 4xx 这类确定性失败不重试（重试也没用）。
async function fetchText(url) {
  try {
    return await fetchOnce(url);
  } catch (err) {
    if (/HTTP 4\d\d/.test(err.message)) throw err;
    await new Promise(r => setTimeout(r, 1200));
    return await fetchOnce(url);
  }
}

// ── 解析 ──────────────────────────────────────────────────────────────────

function rssItems(xml) {
  return xml.split(/<(?:item|entry)[\s>]/).slice(1).map(raw => {
    const dateStr = tag(raw, 'pubDate') || tag(raw, 'published') || tag(raw, 'updated') || tag(raw, 'dc:date');
    const t = Date.parse(dateStr);
    // Atom 的 link 是属性形式，RSS 是文本节点
    const link = tag(raw, 'link') || (/<link[^>]+href="([^"]+)"/.exec(raw) || [])[1] || '';
    return {
      title: stripTags(tag(raw, 'title')),
      link: unescape(link).trim(),
      publishedAt: isNaN(t) ? null : new Date(t).toISOString(),
      ts: isNaN(t) ? 0 : t,
      description: tag(raw, 'description'),
      content: tag(raw, 'content:encoded'),
      raw
    };
  });
}

// 简单源：RSS 本身就是一条一链接
function parseSimple(items, source) {
  return items.map(it => ({
    source: source.name,
    sourceHome: source.home || null,
    title: it.title,
    url: it.link,
    summary: stripTags(it.description).slice(0, 220) || null,
    publishedAt: it.publishedAt
  })).filter(x => x.title && /^https?:/.test(x.url));
}

// AINews：一期是一大篇，正文是被转义两次的 HTML。
// 结构是 <h1> 分区 → <li> 条目，每条 <strong> 标题 + <a> 链接。
function parseAiNews(items, source) {
  const out = [];
  for (const it of items) {
    const html = unescape(it.content || it.description || '');
    if (!html) continue;

    // AINews 的正文是三层：h1 板块 → h2 子版块 → h3 主题。
    // 只取前两层会把「1. Qwen 3.8 27B Coding and Quantization Benchmarks」这类主题丢掉，
    // 所以这里记录完整路径，每条目知道自己在哪一层。
    const heads = [];
    for (const m of html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/g)) {
      heads.push({ level: Number(m[1]), name: stripTags(m[2]), at: m.index });
    }

    // Twitter Recap 不用 h2，它的分组标签是夹在各个 <ul> 之间的独立段落
    //（整段就是一个 <strong>），例如「Agent Harnesses, Persistent Agents, and
    // Enterprise MCP」。层级上它和 Reddit 的 h2 子版块是同一级，按 level 2 收。
    // 条目自己的 <p><strong>标题</strong>：正文</p> 段里 strong 后面还有内容，
    // 不会被下面这个「整段仅一个 strong」的判定命中。
    for (const m of html.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
      const solo = /^<strong>((?:(?!<\/strong>)[\s\S])*)<\/strong>$/.exec(m[1].trim());
      if (!solo) continue;
      const name = stripTags(solo[1]);
      // 必须已经进了某个板块，否则会把开头那句「a quiet day.」当成分组；
      // 带句号的更像一句话而不是标签，也排除掉。
      if (!heads.some(h => h.level === 1 && h.at < m.index)) continue;
      if (name.length < 4 || name.length > 120 || /[.。]$/.test(name)) continue;
      heads.push({ level: 2, name, at: m.index });
    }
    heads.sort((a, b) => a.at - b.at);
    const pathAt = i => {
      const path = [];
      for (const h of heads) {
        if (h.at > i) break;
        path[h.level - 1] = h.name;
        path.length = h.level;      // 进入更高层时丢掉更深的残留
      }
      return path.filter(Boolean);
    };

    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let li;
    while ((li = liRe.exec(html))) {
      const body = li[1];
      const head = stripTags(tag(body, 'strong'));
      if (!head || head.length < 12) continue;
      const links = linksIn(body);
      if (!links.length) continue;

      // <strong> 之后的正文就是这条的背景说明，AINews 每条都有，中位数 530 字符
      const full = stripTags(body);
      let ctx = full.startsWith(head) ? full.slice(head.length) : full;
      ctx = ctx.replace(/^[\s:：—-]+/, '');

      const path = pathAt(li.index);
      out.push({
        source: source.name,
        sourceHome: source.home || null,
        section: path[0] || null,      // AI Twitter Recap / AI Reddit Recap
        subsection: path[1] || null,   // /r/LocalLlama + /r/localLLM Recap
        topic: path[2] || null,        // 1. Qwen 3.8 27B Coding and Quantization…
        title: head,
        url: links[0].url,
        links: links.slice(1),
        summary: clip(ctx, CTX_AINEWS) || null,
        publishedAt: it.publishedAt,
        issueUrl: it.link || null
      });
    }
  }
  return out;
}

// Import AI：一期是一篇长文，正文里的 <a> 就是它引用的论文和项目
function parseArticle(items, source) {
  const out = [];
  for (const it of items) {
    const html = it.content || it.description || '';
    if (!html) continue;
    // 整期本身先收一条，方便点进去读全文
    if (it.link && it.title) {
      out.push({
        source: source.name, sourceHome: source.home || null,
        section: null, title: it.title,
        url: it.link, summary: null, publishedAt: it.publishedAt, isIssue: true
      });
    }
    // 按段落走：链接所在的那段就是 Jack Clark 对它的点评（多是「Why this matters」）。
    // 同一段里的多个链接（论文 + 代码库）指向同一件事，**合成一条**并挂多个链接 ——
    // 早先是各自成条再按点评去重，结果第二条没了描述，看起来像「有的有解释有的没有」。
    const seen = new Set();
    for (const pm of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
      const para = pm[1];
      const paraText = stripTags(para);
      const found = [];
      for (const m of para.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        const url = unescape(m[1]);
        const text = stripTags(m[2]);
        if (!/^https?:/.test(url) || JUNK.test(url) || seen.has(url)) continue;
        if (text.length < 12) continue;   // "here"、"link" 这种没信息量
        seen.add(url);
        found.push({ url, text });
      }
      if (!found.length) continue;

      // 段落去掉所有链接文字，剩下的才是点评
      let ctx = paraText;
      found.forEach(f => { ctx = ctx.replace(f.text, ' '); });
      ctx = ctx.replace(/\s+/g, ' ').trim()
        .replace(/^Why this matters[\s:：—–-]*/i, '').replace(/^[\s:：—–-]+/, '');

      out.push({
        source: source.name, sourceHome: source.home || null,
        section: it.title, title: found[0].text,
        url: found[0].url,
        links: found.slice(1),
        summary: ctx.length > 40 ? clip(ctx, CTX_ARTICLE) : null,
        publishedAt: it.publishedAt
      });
    }
  }
  return out;
}

const PARSERS = { simple: parseSimple, ainews: parseAiNews, article: parseArticle };

// ── 主流程 ────────────────────────────────────────────────────────────────

async function loadSeen() {
  if (!useState || !existsSync(STATE)) return new Set();
  try {
    return new Set(JSON.parse(await readFile(STATE, 'utf-8')).urls || []);
  } catch {
    return new Set();   // 状态文件坏了当空的用，最坏是重复几条链接
  }
}

async function main() {
  const seen = await loadSeen();
  const cutoff = ANCHOR - DAYS * 864e5;
  const report = [];
  let items = [];

  // 一个源挂掉不能拖垮其他源，更不能拖垮整次运行
  const results = await Promise.allSettled(SOURCES.map(async s => {
    const xml = await fetchText(s.url);
    let fresh = rssItems(xml).filter(it => it.ts >= cutoff && it.ts <= ANCHOR);
    if (s.latestOnly && fresh.length) {
      fresh = [fresh.reduce((a, b) => (b.ts > a.ts ? b : a))];
    }
    return { s, parsed: PARSERS[s.kind](fresh, s), total: fresh.length };
  }));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const s = SOURCES[i];
    if (r.status === 'rejected') {
      report.push({ id: s.id, name: s.name, status: 'error', error: String(r.reason?.message || r.reason) });
      continue;
    }
    // 同一 URL 可能在一期里出现多次，也可能昨天已经收过
    const local = new Set();
    const kept = r.value.parsed.filter(x => {
      if (seen.has(x.url) || local.has(x.url)) return false;
      local.add(x.url);
      return true;
    }).slice(0, PER_SOURCE_CAP);

    // 博客源：摘要太短就去文章页的 JSON-LD 里补一份更完整的
    if (s.enrich) {
      await Promise.all(kept.map(async x => {
        if ((x.summary || '').length >= ENRICH_BELOW) return;
        const better = await enrichFromJsonLd(x.url);
        if (better && better.length > (x.summary || '').length) {
          x.summary = clip(better, 400);
          x.enriched = true;
        }
      }));
    }

    kept.forEach(x => seen.add(x.url));
    items = items.concat(kept);
    report.push({ id: s.id, name: s.name, status: 'ok', issues: r.value.total, items: kept.length });
  }

  if (useState) {
    await writeFile(STATE, JSON.stringify({ updatedAt: new Date().toISOString(), urls: [...seen].slice(-SEEN_CAP) }, null, 2));
  }

  console.log(JSON.stringify({
    fetchedAt: new Date().toISOString(),
    windowDays: DAYS,
    windowUntil: new Date(ANCHOR).toISOString(),
    sources: report,
    items
  }, null, 2));
}

main().catch(err => {
  // 补充源失败绝不该让当期简报出不来，所以这里也输出合法结构
  console.log(JSON.stringify({
    fetchedAt: new Date().toISOString(),
    error: err.message,
    sources: [],
    items: []
  }, null, 2));
});
