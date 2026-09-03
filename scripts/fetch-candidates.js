#!/usr/bin/env node

// ============================================================================
// 第一阶段：广度采集候选
// ============================================================================
// 只要标题和元信息，**不抓正文和评论** —— 那是第二阶段（ideas-deepen.js）
// 对通过预筛的少数条目才做的事。两阶段分开的理由很实际：
// 深挖一条 Reddit 帖子要单独一次请求且要退避，全量做会跑成半小时；
// 而九成条目连预筛都过不了，为它们花请求纯属浪费。
//
// 这个脚本是无状态的：抓取随便重跑，结果永远一样。
// 去重在 ideas-archive.js。（fetch-extra.js 把去重放在抓取层，
// 导致「一天只能跑一次」，那是写进 README 的坑，这里不重蹈。）
//
// 用法: node scripts/fetch-candidates.js [--until=YYYY-MM-DD] [--days=N] [--only=id,id]
// 输出: JSON 到 stdout
// ============================================================================

import { BOARDS } from './idea-sources.js';
import {
  fetchText, fetchJson, rssItems, stripTags, unescapeHtml, clip,
  normalizeUrl, hash10
} from './lib/feedkit.js';

const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';

const DAYS = Number(arg('days')) || 3;
// 窗口锚在期号那天的结束，不锚在「现在」—— 同一期号重跑结果才一致。
const ANCHOR = arg('until') ? Date.parse(arg('until') + 'T23:59:59Z') : Date.now();
const ONLY = arg('only') ? new Set(arg('only').split(',')) : null;

const SUMMARY_MAX = 600;      // 一阶段的摘要够预筛判断即可，正文留给二阶段
// Reddit 对同一 IP 的连续请求非常敏感：实测 12 秒仍会 429，20 秒才稳。
const REDDIT_GAP = 25_000;
const REDDIT_TRIES = 3;

// 版规帖、月度合集这类固定楼，标题就能认出来
const REDDIT_NOISE = /monthly|weekly|megathread|showcase|read before|rules|announcement|mod post/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tidy = (s, text) => (s.trimTail ? String(text || '').replace(s.trimTail, '') : text);

const base = (s, extra) => ({
  sourceId: s.id, source: s.name, sourceHome: s.home || null,
  side: s.side, pool: !!s.pool, ...extra
});

// ── 各源的解析 ────────────────────────────────────────────────────────────

function fromRss(xml, s, cutoff) {
  // dateless 源（Product Hunt）：它的 Atom 里 <published> 是产品首次发布日、
  // <updated> 才是上榜日，按 published 卡时间窗会把当天的榜几乎全滤掉。
  // 这类「最新在最前」的 feed 直接取头部，重复的交给 archive 去重。
  return rssItems(xml)
    .filter(it => s.dateless || (it.ts >= cutoff && it.ts <= ANCHOR))
    .map(it => base(s, {
      title: it.title,
      url: it.link,
      // 先 unescape 再 stripTags，顺序不能反：PH 的 content 是二次转义的 HTML
      summary: clip(tidy(s, stripTags(unescapeHtml(it.description || it.content))), SUMMARY_MAX) || null,
      publishedAt: it.publishedAt
    }))
    .filter(x => x.title && /^https?:/.test(x.url));
}

// Reddit 的 content 是帖子正文的 HTML，末尾挂着 submitted by / [link] [comments]
const redditBody = html => stripTags(unescapeHtml(html || ''))
  .replace(/submitted by\s+\/u\/\S+.*$/i, '')
  .replace(/\[link\]|\[comments\]/gi, '')
  .trim();

// 帖子永久链接末尾加 .rss 就能拿到正文 + 全部评论，深挖阶段用得上
const permalinkKey = url => {
  const m = /reddit\.com(\/r\/[^/]+\/comments\/[^/]+)/.exec(url || '');
  return m ? m[1] : null;
};

function fromReddit(xml, s, cutoff, sub) {
  return rssItems(xml)
    .filter(it => it.ts >= cutoff && it.ts <= ANCHOR)
    .filter(it => !REDDIT_NOISE.test(it.title))
    .map(it => base(s, {
      title: it.title,
      url: it.link,
      summary: clip(redditBody(it.content), SUMMARY_MAX) || null,
      deepenKey: permalinkKey(it.link),
      via: sub || null,                    // 短语搜索时记下命中的是哪条短语
      publishedAt: it.publishedAt
    }))
    .filter(x => x.title && /^https?:/.test(x.url));
}

// Stack Exchange：整站就是「我需要一个能做 X 的软件」，body 直接给全文。
// unanswered 那批尤其值钱 —— 没人答得上来，等于站方替你标好了缺口。
function fromStackExchange(json, s, mode) {
  return (json.items || []).map(q => base(s, {
    title: unescapeHtml(q.title || ''),
    url: q.link,
    summary: clip(stripTags(q.body || ''), SUMMARY_MAX) || null,
    deepenKey: String(q.question_id),
    signal: {
      score: q.score, views: q.view_count, answers: q.answer_count,
      unanswered: mode === 'unanswered'
    },
    publishedAt: new Date((q.creation_date || 0) * 1000).toISOString()
  })).filter(x => x.title && x.url);
}

function fromHn(json, s, cutoff, phrase) {
  return (json.hits || [])
    .filter(h => {
      const t = Date.parse(h.created_at);
      return t >= cutoff && t <= ANCHOR && (h.points || 0) >= (s.minPoints || 0);
    })
    .map(h => base(s, {
      // 讨论页永远存在，外链有时是空的（纯文字帖），所以 url 取讨论页 ——
      // 点进去总能看到评论区的真实反馈。
      title: String(h.title || '').replace(/^(Show HN|Ask HN|Tell HN):\s*/i, ''),
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      externalUrl: h.url || null,
      summary: clip(stripTags(unescapeHtml(h.story_text || '')), SUMMARY_MAX) || null,
      deepenKey: String(h.objectID),
      via: phrase || null,
      signal: { points: h.points || 0, comments: h.num_comments || 0 },
      publishedAt: h.created_at
    }))
    .filter(x => x.title);
}

// GitHub 的 enhancement issue：几十上百人给同一个功能点赞，
// 需求真实性有数字兜底，而且缺口写得比任何帖子都清楚。
function fromGithubIssues(json, s) {
  return (json.items || []).map(i => base(s, {
    title: i.title,
    url: i.html_url,
    summary: clip(String(i.body || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' '), SUMMARY_MAX) || null,
    signal: {
      thumbsUp: i.reactions?.['+1'] || 0,
      comments: i.comments || 0,
      repo: i.repository_url?.split('/').slice(-2).join('/') || null
    },
    publishedAt: i.created_at
  })).filter(x => x.title);
}

// YC 的 RFS 页面是服务端渲染的 Tailwind，标题和正文各自有稳定的 class 特征。
// 两者数量对不上就说明改版了 —— 那时宁可返回 0 条也不要错位配对，
// 错位的后果是「标题说 A、正文讲 B」，比缺一块难发现得多。
function fromYcRfs(html, s) {
  const clean = t => stripTags(t).replace(/\s*#$/, '').trim();
  const titles = [...html.matchAll(/<h3[^>]*class="mb-2 font-[^"]*"[^>]*>([\s\S]*?)<\/h3>/g)].map(m => clean(m[1]));
  const bodies = [...html.matchAll(/class="whitespace-pre-wrap[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/g)].map(m => clean(m[1]));
  if (!titles.length || titles.length !== bodies.length) {
    throw new Error(`页面结构变了：标题 ${titles.length} 条、正文 ${bodies.length} 条，对不上`);
  }
  return titles.map((t, i) => base(s, {
    title: t,
    url: `${s.url}#${t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    summary: clip(bodies[i], 500) || null,
    publishedAt: null       // RFS 页面不给日期，靠 seen 去重而不是靠时间窗
  }));
}

// ── 抓取 ──────────────────────────────────────────────────────────────────

async function fetchSource(s, defaultCutoff) {
  // 低流量的源可以自己声明更宽的窗口（r/SomebodyMakeThis 一天只有三五条）
  const cutoff = s.windowDays ? ANCHOR - s.windowDays * 864e5 : defaultCutoff;

  switch (s.kind) {
    case 'rss':    return fromRss(await fetchText(s.url), s, cutoff);
    case 'reddit': return fromReddit(await fetchText(s.url), s, cutoff);
    case 'ycrfs':  return fromYcRfs(await fetchText(s.url), s);
    case 'hn':     return fromHn(await fetchJson(s.url), s, cutoff);

    case 'reddit-search': {
      // 一条短语一次请求，串行 + 退避（reddit 对连续请求很敏感）。
      // **单条短语被限流只跳过它，不拖垮整组** —— 早先是整组一起抛，
      // 结果四条里有一条 429，当期一条需求帖都没有。
      let out = [];
      const failed = [];
      for (let i = 0; i < s.phrases.length; i++) {
        if (i) await sleep(REDDIT_GAP);
        const u = `${s.url}?q=${encodeURIComponent(`"${s.phrases[i]}"`)}` +
          `&sort=new&t=${s.window || 'week'}&limit=25&include_over_18=off`;
        try {
          out = out.concat(fromReddit(await fetchText(u), s, cutoff, s.phrases[i]));
        } catch (err) {
          failed.push(`${s.phrases[i]}（${String(err && err.message || err).slice(0, 40)}）`);
        }
      }
      if (failed.length === s.phrases.length) throw new Error(`全部短语失败：${failed.join('；')}`);
      if (failed.length) out.partialError = failed.join('；');
      return out;
    }

    // 早先这里做的是短语搜索（"is there a tool that" 之类），实测捞回来的是
    // 2010–2022 年、1–9 分的老帖 —— 十年前问「有没有这种工具」，现在多半有了。
    // 改成取**最近的 Ask HN**，让预筛那一步去认需求短语：新鲜度和互动量先保住，
    // 是不是需求由 ideas-screen.js 判断。
    case 'ask-hn': {
      const u = `${s.url}?tags=ask_hn&hitsPerPage=100`;
      return fromHn(await fetchJson(u), s, cutoff);
    }

    case 'stackexchange': {
      let out = [];
      for (const mode of s.modes) {
        // filter=withbody 才给正文；不给的话拿到的只是标题，和 v1 一个毛病
        const path = mode === 'unanswered' ? '/unanswered' : '';
        const u = `${s.url}${path}?site=${s.site}&order=desc&sort=${mode === 'unanswered' ? 'activity' : 'creation'}` +
          `&filter=withbody&pagesize=30`;
        out = out.concat(fromStackExchange(await fetchJson(u), s, mode));
      }
      // unanswered 那批没有时间窗（老问题一样是缺口），recent 那批要卡窗
      return out.filter(x => x.signal?.unanswered || Date.parse(x.publishedAt) >= cutoff);
    }

    case 'github-issues': {
      const since = new Date(ANCHOR - (s.windowDays || 45) * 864e5).toISOString().slice(0, 10);
      const q = `is:issue is:open label:enhancement created:>${since} reactions:>${s.minReactions || 25}`;
      const u = `${s.url}?q=${encodeURIComponent(q)}&sort=reactions&order=desc&per_page=${s.cap || 15}`;
      return fromGithubIssues(await fetchJson(u, { headers: { accept: 'application/vnd.github+json' } }), s);
    }

    default: throw new Error(`未知的源类型 ${s.kind}`);
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────

function finish(s, list) {
  // id 由归一化 URL 决定而不是由源决定 —— 同一件事从两个源各进来一次时，
  // ideas-archive.js 才认得出它们是同一条。
  const local = new Set();
  return list
    .map(x => {
      const norm = normalizeUrl(x.url);
      return { id: hash10(norm), normUrl: norm, ...x };
    })
    .filter(x => (local.has(x.id) ? false : (local.add(x.id), true)))
    .slice(0, s.cap || 20);
}

async function main() {
  const targets = BOARDS.filter(s => !ONLY || ONLY.has(s.id));
  const cutoff = ANCHOR - DAYS * 864e5;
  const report = [];
  let items = [];

  const run = async (s, tries = 1) => {
    for (let i = 1; ; i++) {
      try {
        const raw = await fetchSource(s, cutoff);
        return { s, ok: true, list: finish(s, raw), partialError: raw.partialError || null };
      } catch (err) {
        const msg = String(err?.message || err);
        if (i >= tries || !/HTTP 429/.test(msg)) return { s, ok: false, error: msg };
        await sleep(REDDIT_GAP * i);
      }
    }
  };

  // 走 reddit 的源串行（它们共用同一个 IP 配额），其余并发
  const isReddit = s => s.kind === 'reddit' || s.kind === 'reddit-search';
  const reddits = targets.filter(isReddit);
  const rest = targets.filter(s => !isReddit(s));

  const restPromise = Promise.all(rest.map(s => run(s)));
  const redditResults = [];
  for (let i = 0; i < reddits.length; i++) {
    if (i) await sleep(REDDIT_GAP);
    redditResults.push(await run(reddits[i], REDDIT_TRIES));
  }
  const results = [...redditResults, ...await restPromise];

  // 输出顺序按注册表，不按完成先后 —— 同一期跑两次结果逐字节一致
  results.sort((a, b) => BOARDS.indexOf(a.s) - BOARDS.indexOf(b.s));

  for (const r of results) {
    if (!r.ok) {
      report.push({ id: r.s.id, name: r.s.name, status: 'error', pool: !!r.s.pool, error: r.error });
      continue;
    }
    items = items.concat(r.list);
    report.push({
      id: r.s.id, name: r.s.name, status: r.partialError ? 'partial' : 'ok',
      items: r.list.length, pool: !!r.s.pool,
      ...(r.partialError ? { error: r.partialError } : {})
    });
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
  // 抓取整个崩了也要输出合法结构，下游据此报「管道断了」而不是「今天没内容」
  console.log(JSON.stringify({
    fetchedAt: new Date().toISOString(),
    error: String(err?.message || err),
    sources: [], items: []
  }, null, 2));
});
