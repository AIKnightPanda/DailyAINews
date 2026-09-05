#!/usr/bin/env node

// ============================================================================
// 第二阶段：对入围的候选深挖正文和评论
// ============================================================================
// 这一步是 v2 的核心。v1 只有标题和 200 字摘要，判断依据薄到必然出错：
//
//   2026-09-02，r/SomebodyMakeThis 上「截图 30 秒后自动删除」被选为当日第一。
//   而那条帖子的**第一条评论**是「iOS 本来就有这个功能」，发帖人自己回了
//   「INCREDIBLE! Thank you!」。标题和摘要里没有这句话，只有评论区有。
//
// 评论区是「有没有竞品、需求真不真、是不是已经解决了」的唯一可靠答案。
// 所以入围的条目必须连评论一起抓下来，再交给模型判断。
//
// 只对预筛选出的少数条目做（默认 20 条）—— 全量深挖要跑半小时，
// 而九成条目连预筛都过不了，为它们花请求纯属浪费。
//
// 用法: node scripts/ideas-deepen.js [--issue=YYYY-MM-DD] [--top=N] [--force]
// 就地更新 ideas/raw/<期号>.json：给入围条目加 deep 字段和 screen 字段
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pickForDeepen, screen } from './lib/screen.js';
import { fetchText, fetchJson, rssItems, stripTags, unescapeHtml, clip } from './lib/feedkit.js';
import { sourceById } from './idea-sources.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const force = process.argv.includes('--force');

const TOP = Number(arg('top')) || 18;
const SUPPLY_TOP = Number(arg('supply')) || 14;
const REDDIT_GAP = 20_000;

const BODY_MAX = 2200;      // 正文给足 —— 背景、问题、现状全在这儿
// 2026-09-05 从 500 提到 900：读者发现好几条评论被硬生生砍在句子中间——
// 500 字对「有人报具体单价」「有人指出竞品」这类信息量最大的评论太紧，
// 越是值得引用的评论越长，越容易被砍。clip() 本身也顺手改成更愿意找
// 句末断点，两处一起才能把这个问题压下去。
const COMMENT_MAX = 900;    // 单条评论
const COMMENTS_KEEP = 8;    // 每条最多留几条评论

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 各源怎么深挖 ──────────────────────────────────────────────────────────

// Reddit：帖子永久链接后面加 .rss 就能拿到正文 + 全部评论。
// （.json 端点对浏览器 UA 一律 403，只有 .rss 这条路走得通。）
// 第一个 entry 是帖子本身，其余都是评论，按 RSS 里的顺序（sort=top）。
async function deepenReddit(item) {
  const url = `https://www.reddit.com${item.deepenKey}/.rss?limit=25&sort=top`;
  const entries = rssItems(await fetchText(url));
  if (!entries.length) throw new Error('RSS 里没有 entry');

  const clean = html => stripTags(unescapeHtml(html || ''))
    .replace(/submitted by\s+\/u\/\S+.*$/i, '')
    .replace(/\[link\]|\[comments\]/gi, '')
    .trim();

  const [post, ...rest] = entries;
  return {
    body: clip(clean(post.content), BODY_MAX),
    comments: rest
      .map(e => clip(clean(e.content), COMMENT_MAX))
      .filter(t => t.length > 25)          // "Thanks!" 这类没有信息量
      .slice(0, COMMENTS_KEEP)
      .map(text => ({ text })),
    source: 'reddit'
  };
}

// HN：Algolia 的 items 接口给整棵评论树，取顶层的前几条
async function deepenHn(item) {
  const j = await fetchJson(`https://hn.algolia.com/api/v1/items/${item.deepenKey}`);
  const text = t => stripTags(unescapeHtml(t || ''));
  return {
    body: clip(text(j.text), BODY_MAX),
    comments: (j.children || [])
      .map(c => ({ text: clip(text(c.text), COMMENT_MAX) }))
      .filter(c => c.text.length > 25)
      .slice(0, COMMENTS_KEEP),
    source: 'hn'
  };
}

// Stack Exchange：正文单独再问一次接口拿完整版，不能偷懒用 item.summary。
// item.summary 是一阶段给预筛用的 600 字裁剪，2026-09-05 读者发现拿它
// 冒充「深挖后的正文」，遇到长一点的帖子就会截断成不完整的文档——
// 一阶段的 API 请求本来就拿到了完整正文（filter=withbody），只是裁短
// 之后就把全文扔了，深挖阶段这里必须自己再问一遍，跟 reddit/hn 一样
// 按 BODY_MAX 走，而不是沿用预筛那个更紧的上限。
// 有答案 = 已有现成方案（答案里就写着叫什么）；没答案 = 缺口还在。
async function deepenStackExchange(item) {
  const qUrl = `https://api.stackexchange.com/2.3/questions/${item.deepenKey}` +
    `?site=softwarerecs&filter=withbody`;
  const aUrl = `https://api.stackexchange.com/2.3/questions/${item.deepenKey}/answers` +
    `?site=softwarerecs&order=desc&sort=votes&filter=withbody&pagesize=5`;
  const [qj, aj] = await Promise.all([fetchJson(qUrl), fetchJson(aUrl)]);
  const q = (qj.items || [])[0];
  return {
    body: clip(stripTags(q?.body || item.summary || ''), BODY_MAX),
    comments: (aj.items || [])
      .map(a => ({ text: clip(stripTags(a.body || ''), COMMENT_MAX), score: a.score }))
      .filter(c => c.text.length > 25),
    source: 'stackexchange'
  };
}

// Product Hunt 没有评论区可抓，「深挖」在这里只做一件事：把服务端渲染的
// 产品页拿下来，正则挖 followersCount —— 关注数比 RSS 里那句产品描述更能
// 说明这条上新有没有人真的在意，读者要求加上（2026-09-05）。
// PH 是 Next.js 应用，但这个数字已经在首屏 HTML 里的水合数据里，不用跑 JS。
//
// 2026-09-05 实测：连续访问约 12 个产品页之后，Product Hunt 的 Cloudflare
// 直接开始返回「Just a moment...」challenge 页，90 秒后单独重试同一个 URL
// 仍然被挡——不是简单的按请求限流，像是这个 IP 被判了一段时间的封禁。
// 所以这里**绝不能抛错让整条item 连带出局**：抓不到关注数只是拿不到这一个
// 数字，不该连累这条本来就该展示的候选。失败就静默退化成没有 signal。
async function deepenProductHunt(item) {
  try {
    const html = await fetchText(item.url);
    const m = html.match(/"followersCount":(\d+)/);
    return {
      body: item.summary || '',
      comments: [],
      source: 'producthunt',
      signal: m ? { followers: Number(m[1]) } : {}
    };
  } catch {
    return { body: item.summary || '', comments: [], source: 'producthunt' };
  }
}

const DEEPENERS = {
  reddit: deepenReddit, hn: deepenHn, stackexchange: deepenStackExchange,
  producthunt: deepenProductHunt
};

// 竞品线索：拿标题里最有辨识度的几个词去 HN 搜一遍。
// 评论区是竞品信息的第一来源（那条 iOS 的教训就在评论里），这是补充。
// 免费、无限流，一条一次请求。搜不到就是搜不到，不编。
const STOP = new Set(('a an the and or of for to in on with without is are be my our your that this ' +
  'it its i we you they how what which when where why can do does need want app tool software new best').split(' '));

async function priorArt(title) {
  const words = String(title).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !STOP.has(w)).slice(0, 4);
  if (words.length < 2) return [];
  try {
    const u = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(words.join(' '))}` +
      `&tags=story&hitsPerPage=5`;
    const j = await fetchJson(u);
    return (j.hits || [])
      .filter(h => (h.points || 0) >= 10)
      .slice(0, 3)
      .map(h => ({ title: h.title, points: h.points, url: `https://news.ycombinator.com/item?id=${h.objectID}` }));
  } catch {
    return [];   // 找不到先例不影响判断，只是少一条线索
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────

function todayCN() {
  return new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10);
}

async function main() {
  const issue = arg('issue') || todayCN();
  const path = join(ROOT, 'ideas', 'raw', `${issue}.json`);
  if (!existsSync(path)) { console.error(`找不到 ${path}，先跑 ideas-archive.js`); process.exit(1); }

  const data = JSON.parse(readFileSync(path, 'utf-8'));

  // pool / side 从注册表现算，不信归档里存的那份 —— 注册表才是真相源。
  // 改了源的归属之后不必重抓一遍（重抓要五分钟且会撞 reddit 限流）。
  for (const it of data.items) {
    const src = sourceById(it.sourceId);
    if (src) { it.pool = !!src.pool; it.side = src.side; }
  }
  const pool = data.items.filter(x => x.pool);

  // 每条都记下预筛结果 —— 包括没入围的。页面上能解释「这条为什么没进」，
  // 也让你回头能看出规则是不是筛错了。
  for (const it of data.items) {
    it.screen = it.pool ? screen(it) : { keep: false, score: 0, reason: '附录源，不参与评选', hits: [] };
    // 每次重算都要先清空：规则改了之后名单会变，上一轮入围的条目
    // 不清掉就会一直挂着 candidate 标记，候选数越滚越多（实测滚到过 23/20）。
    it.candidate = false;
  }

  // 两条通道各自选拔，名额分开算 —— 供给侧不该和需求侧抢名额，
  // 它们回答的是不同的问题，混在一起排会让当天热闹的那一侧吃掉全部名额。
  const demand = pool.filter(x => x.side !== 'supply');
  const supply = pool.filter(x => x.side === 'supply');

  const { chosen: demandPick } = pickForDeepen(demand, {
    top: TOP,
    // Ask HN 大半是闲聊、GitHub 大半是给现成产品提功能，留一两个名额就够
    caps: { 'hn-ask': 3, 'gh-requests': 2, softwarerecs: 5 }
  });
  // 供给侧里 Show HN 深挖评论区；Product Hunt 自带一句话描述已经够写
  // 「这是什么」了，深挖只是顺带去产品页拿 followersCount，拿不到不影响入选。
  const { chosen: supplyPick } = pickForDeepen(supply, {
    top: SUPPLY_TOP, perSource: 12, minScore: 4
  });
  const chosen = [...demandPick, ...supplyPick];
  const targets = chosen.filter(({ it }) => force || !it.deep);

  let ok = 0;
  const failed = [];
  let lastReddit = 0;
  let lastPH = 0;

  for (const { it } of targets) {
    const kind = sourceById(it.sourceId)?.deepen || 'none';
    const fn = DEEPENERS[kind];

    // reddit 之间要拉开间隔，其余源不用等
    if (kind === 'reddit') {
      const wait = REDDIT_GAP - (Date.now() - lastReddit);
      if (lastReddit && wait > 0) await sleep(wait);
      lastReddit = Date.now();
    }
    // Product Hunt 同理：2026-09-05 实测短时间内连续访问约 12 个产品页就会
    // 触发 Cloudflare 的 challenge，拉开间隔降低连续触发的概率
    // （拉开间隔也不保证不触发，触发之后 deepenProductHunt 会静默退化）
    if (kind === 'producthunt') {
      const wait = REDDIT_GAP - (Date.now() - lastPH);
      if (lastPH && wait > 0) await sleep(wait);
      lastPH = Date.now();
    }

    try {
      const deep = fn ? await fn(it) : { body: it.summary || '', comments: [], source: 'none' };
      deep.priorArt = await priorArt(it.title);
      deep.fetchedAt = new Date().toISOString();
      it.deep = deep;
      if (deep.signal) it.signal = { ...(it.signal || {}), ...deep.signal };
      it.candidate = true;
      ok++;
    } catch (err) {
      // 深挖失败的条目**不进候选**：宁可少几条，也不要让模型对着
      // 标题和摘要硬判断 —— 那正是 v1 的毛病。
      it.candidate = false;
      it.deepError = String(err?.message || err).slice(0, 120);
      failed.push(`${it.ref || it.id}（${it.deepError}）`);
    }
  }

  // 被限流的再试一轮，间隔加倍。
  // reddit 的 429 是「等一等就好」而不是「这条抓不到」，一轮就放弃太浪费 ——
  // 深挖失败的条目直接不进候选，等于白抓了前面那一整轮。
  const retry = targets.filter(({ it }) => /HTTP 429/.test(it.deepError || ''));
  if (retry.length) {
    console.error(`[deepen] ${retry.length} 条被限流，隔久一点再试一轮`);
    for (const { it } of retry) {
      await sleep(REDDIT_GAP * 2);
      try {
        const kind = sourceById(it.sourceId)?.deepen || 'none';
        const deep = await DEEPENERS[kind](it);
        deep.priorArt = await priorArt(it.title);
        deep.fetchedAt = new Date().toISOString();
        it.deep = deep;
        if (deep.signal) it.signal = { ...(it.signal || {}), ...deep.signal };
        it.candidate = true;
        it.deepError = null;
        ok++;
        const at = failed.findIndex(f => f.startsWith(String(it.ref)));
        if (at >= 0) failed.splice(at, 1);
      } catch (err) {
        it.deepError = String(err?.message || err).slice(0, 120);
      }
    }
  }

  // 入围但这次没重新抓的（已有 deep）也算候选
  for (const { it } of chosen) if (it.deep) it.candidate = true;

  data.deepenedAt = new Date().toISOString();
  data.counts = {
    ...data.counts,
    pool: pool.length,
    screened: pool.filter(x => x.screen?.keep).length,
    candidates: data.items.filter(x => x.candidate).length,
    demandCandidates: data.items.filter(x => x.candidate && x.side !== 'supply').length,
    supplyCandidates: data.items.filter(x => x.candidate && x.side === 'supply').length
  };
  writeFileSync(path, JSON.stringify(data, null, 2));

  console.error(`[deepen] ${issue}：池内 ${pool.length} 条 → 过筛 ${data.counts.screened} 条 ` +
    `→ 深挖 ${ok}/${targets.length} 条成功`);
  if (failed.length) console.error(`[deepen] 深挖失败：${failed.join('、')}`);

  console.log(JSON.stringify({
    status: data.counts.candidates ? 'ok' : 'empty',
    issue,
    pool: pool.length,
    screened: data.counts.screened,
    candidates: data.counts.candidates,
    failed
  }));
}

main().catch(err => {
  console.log(JSON.stringify({ status: 'error', message: String(err?.message || err) }));
  process.exit(1);
});
