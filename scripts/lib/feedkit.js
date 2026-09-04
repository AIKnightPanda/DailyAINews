// ============================================================================
// RSS / HTML 解析的通用小工具
// ============================================================================
// 灵感模块（fetch-boards.js / fetch-inbox.js）共用这一份。
//
// 注意：`scripts/fetch-extra.js` 里还有一份自己的同名实现，**没有合并**。
// 那条路径每天 05:30 在跑，为了一个新模块去动它不划算 —— 这些函数是纯函数，
// 各自演化最坏也只是代码重复，不会像 groups.js 那样造成两边配置漂移。
// 哪天要合，先跑一次 fetch-extra.js 对比输出再动手。
// ============================================================================

import { createHash } from 'crypto';

const ENT = {
  lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', amp: '&',
  mdash: '—', ndash: '–', hellip: '…',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”'
};

// &amp; 放最后解，否则 &amp;lt; 会被解成 < 而不是 &lt;
export const unescapeHtml = s => String(s || '')
  .replace(/&(lt|gt|quot|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo);/g, (_, e) => ENT[e])
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

export const stripTags = s =>
  unescapeHtml(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export const tag = (block, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(block);
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '') : '';
};

// 尽量截在句末，避免把话砍在半截。
// 2026-09-05 把「找不到句末」时的退路从「硬切在第 max 个字符」改成
// 「至少退到最后一个空格」——读者发现过评论被砍在单词中间（"...almost
// entirely startups and inter…"），原因是最近的句末标点在前 50% 之外时
// 直接硬切，硬切点常常落在单词内部。现在分两级：先找句末标点（门槛也从
// 50% 放宽到 35%，更容易接受一个稍靠前但完整的句子），找不到再退到最后
// 一个词边界，都找不到才认了整词砍断。
export function clip(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (stop > max * 0.35) return cut.slice(0, stop + 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

// 实测 news.smol.ai 会在 TLS 握手阶段 RESET 掉带 "(compatible; …)" 的 UA，
// 换常规浏览器 UA 后才通。抓的都是公开接口，用标准 UA 即可。
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const TIMEOUT = 20_000;

async function fetchOnce(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      ...opts,
      headers: { 'user-agent': UA, ...(opts.headers || {}) }
    });
    if (!res.ok) {
      // 站点自己返回的 403 和被出网网关拦下的 403 状态码一样，只有正文能区分。
      // 2026-08 那次五源全 403 就是靠正文里的拦截页文案才认出是白名单问题。
      let hint = '';
      try {
        const body = (await res.text())
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          .split(/[({]/)[0].trim();
        if (body) hint = `：${body.slice(0, 70)}`;
      } catch { /* 读不出正文就算了 */ }
      throw new Error(`HTTP ${res.status}${hint}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 并发抓时偶发 fetch failed，直连却没问题 —— 瞬时抖动，重试一次即可。
// HTTP 4xx 是确定性失败，重试没意义。
// 唯一的例外是 429：Reddit 就靠它限速，退避后重试是有用的。
export async function fetchRes(url, opts = {}) {
  try {
    return await fetchOnce(url, opts);
  } catch (err) {
    const m = /HTTP (\d\d\d)/.exec(err.message);
    if (m && m[1] !== '429') throw err;
    await new Promise(r => setTimeout(r, m?.[1] === '429' ? 8000 : 1200));
    return await fetchOnce(url, opts);
  }
}

export const fetchText = async (url, opts) => (await fetchRes(url, opts)).text();
export const fetchJson = async (url, opts) => (await fetchRes(url, opts)).json();

// RSS 与 Atom 通吃：Atom 的 link 是属性形式，RSS 是文本节点
export function rssItems(xml) {
  return xml.split(/<(?:item|entry)[\s>]/).slice(1).map(raw => {
    const dateStr = tag(raw, 'pubDate') || tag(raw, 'published') || tag(raw, 'updated') || tag(raw, 'dc:date');
    const t = Date.parse(dateStr);
    const link = tag(raw, 'link') || (/<link[^>]+href="([^"]+)"/.exec(raw) || [])[1] || '';
    return {
      title: stripTags(tag(raw, 'title')),
      link: unescapeHtml(link).trim(),
      publishedAt: isNaN(t) ? null : new Date(t).toISOString(),
      ts: isNaN(t) ? 0 : t,
      description: tag(raw, 'description') || tag(raw, 'summary'),
      content: tag(raw, 'content:encoded') || tag(raw, 'content'),
      raw
    };
  });
}

// ── 去重的地基 ────────────────────────────────────────────────────────────
// 同一个点子会从多个源撞进来（Show HN 发一次、Product Hunt 再发一次），
// 所以 id 必须由**归一化后的 URL** 决定，而不是由源决定 —— 否则跨源合流做不了。

const TRACKING = /^(utm_|ref$|ref_|source$|via$|fbclid$|gclid$|mc_cid$|mc_eid$|_hs|igshid$)/i;

export function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw));
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.protocol = 'https:';
    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING.test(k)) u.searchParams.delete(k);
    }
    u.search = u.searchParams.toString() ? `?${u.searchParams}` : '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch {
    return String(raw || '').trim();
  }
}

export const hash10 = s => createHash('sha1').update(String(s)).digest('hex').slice(0, 10);

// 标题指纹：URL 不同但讲同一件事时的兜底（Show HN 和 PH 同一天发同一个产品）。
// 只保留字母数字和 CJK，压掉大小写与标点，取前 60 个字符。
export const titleKey = t => String(t || '')
  .toLowerCase()
  .replace(/^(show hn|ask hn|launch hn)\s*[:：]\s*/i, '')
  .replace(/[^a-z0-9一-鿿]+/g, '')
  .slice(0, 60);
