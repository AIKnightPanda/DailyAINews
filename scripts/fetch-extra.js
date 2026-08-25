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

const SEEN_CAP = 800;      // 状态文件里保留多少条已见 URL
const PER_SOURCE_CAP = 40; // 单个源单次最多收多少条，防止某天异常刷屏
const TIMEOUT = 20_000;

const SOURCES = [
  { id: 'ainews',   name: 'AINews',         kind: 'ainews',  url: 'https://news.smol.ai/rss.xml' },
  { id: 'importai', name: 'Import AI',      kind: 'article', url: 'https://jack-clark.net/feed/' },
  { id: 'openai',   name: 'OpenAI',         kind: 'simple',  url: 'https://openai.com/news/rss.xml' },
  { id: 'deepmind', name: 'Google DeepMind',kind: 'simple',  url: 'https://deepmind.google/blog/rss.xml' },
  { id: 'rundown',  name: 'The Rundown AI', kind: 'simple',  url: 'https://www.therundown.ai/feed' }
];

// 订阅、登录、分享这类功能性链接不是内容，过滤掉
const JUNK = /\/(subscribe|unsubscribe|login|signup|account|privacy|terms|cdn-cgi)\b|utm_|\/feed\/?$|substack\.com\/(subscribe|app)|support\./i;

// ── 小工具 ────────────────────────────────────────────────────────────────

const ENT = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#039': "'", amp: '&' };
// &amp; 放最后解，否则 &amp;lt; 会被解成 < 而不是 &lt;
const unescape = s => s
  .replace(/&(lt|gt|quot|apos|nbsp|#39|#039);/g, (_, e) => ENT[e])
  .replace(/&amp;/g, '&');

const stripTags = s => unescape(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const tag = (block, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(block);
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '') : '';
};

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; DailyAI/1.0)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
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

    // 按 h1/h2 切分区，让每条知道自己属于哪个板块
    const sections = [];
    const re = /<h([12])[^>]*>([\s\S]*?)<\/h\1>/g;
    let m, last = null;
    while ((m = re.exec(html))) {
      if (last) last.end = m.index;
      last = { name: stripTags(m[2]), start: re.lastIndex, end: html.length };
      sections.push(last);
    }
    const sectionAt = i => (sections.find(s => i >= s.start && i < s.end) || {}).name || null;

    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    let li;
    while ((li = liRe.exec(html))) {
      const body = li[1];
      const head = stripTags(tag(body, 'strong'));
      const href = (/<a[^>]+href="([^"]+)"/.exec(body) || [])[1];
      if (!head || !href || head.length < 12) continue;
      const url = unescape(href);
      if (!/^https?:/.test(url) || JUNK.test(url)) continue;
      out.push({
        source: source.name,
        section: sectionAt(li.index),
        title: head,
        url,
        summary: null,
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
        source: source.name, section: null, title: it.title,
        url: it.link, summary: null, publishedAt: it.publishedAt, isIssue: true
      });
    }
    for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const url = unescape(m[1]);
      const text = stripTags(m[2]);
      if (!/^https?:/.test(url) || JUNK.test(url)) continue;
      if (text.length < 12) continue;   // "here"、"link" 这种没信息量
      out.push({
        source: source.name, section: it.title, title: text,
        url, summary: null, publishedAt: it.publishedAt
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
  const cutoff = Date.now() - DAYS * 864e5;
  const report = [];
  let items = [];

  // 一个源挂掉不能拖垮其他源，更不能拖垮整次运行
  const results = await Promise.allSettled(SOURCES.map(async s => {
    const xml = await fetchText(s.url);
    const fresh = rssItems(xml).filter(it => it.ts >= cutoff);
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
