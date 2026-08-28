// ============================================================================
// 还原博客正文的分段与链接
// ============================================================================
// 上游 feed 给的 blogs[].content 是一整坨扁平文本：没有换行、没有小标题、
// 没有任何链接（2026-08-27 实测 7121 字符里 0 个 \n、0 个 http）。读起来是一堵墙，
// 文章里引用的 YouTube 演示、文档页、评测报告这些**属于内容本身**的链接也全丢了。
//
// 所以这里回原文页自己取一遍结构。关键设计是**拿 feed 的扁平正文当锚**：
// 只保留那些在 feed 正文里确实出现过的块。这样做有三个好处 ——
//   1. 导航栏、相关文章、页脚、订阅框自动被滤掉，不用为每个站点写选择器
//   2. 绝不会引入 feed 里没有的内容，还原的是结构，不是内容
//   3. 站点改版导致提取跑偏时，覆盖率会掉下来，能自己发现
//
// 抓不到就退回扁平正文 —— 这一步是锦上添花，绝不能让当期简报出不来。
// ============================================================================

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const TIMEOUT_MS = 25_000;
const MIN_COVERAGE = 0.5;   // 还原出的块覆盖不到扁平正文一半，就当提取失败

async function fetchText(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

const ENT = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&apos;': "'", '&#39;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…'
};

export function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, m => (m in ENT ? ENT[m] : ' '));
}

// 行内标签里只有 <a> 值得留 —— 把它转成 markdown 链接，其余一律抹平
function inlineToText(frag, base) {
  const withLinks = frag.replace(
    /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (whole, href, inner) => {
      const label = decode(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      if (!label) return '';
      let abs;
      // 原文里偶尔会写成 href=" /blog/xxx"，不剪空白会被编码成 %20 变成死链
      try { abs = new URL(href.trim(), base).href; } catch { return label; }
      if (!/^https?:/i.test(abs)) return label;            // mailto:、锚点、js: 都只留文字
      if (abs.replace(/#.*$/, '') === base.replace(/#.*$/, '')) return label;  // 自指链接没意义
      return `[${label}](${abs})`;
    }
  );
  return decode(withLinks.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/[ \t ​]+/g, ' ')
    .trim();
}

// 把块文字变成「只剩字母数字和汉字」的形态，用来和扁平正文比对。
// feed 那份扁平化会在行内元素前后塞空格（"connect to Claude ." 就是这么来的），
// 所以比对必须对空白和标点都不敏感。
const squash = s => s
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * 从文章 HTML 里抽出结构块。
 * @returns {{tag: string, text: string}[]}
 */
export function extractBlocks(html, baseUrl) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form|noscript)\b[\s\S]*?<\/\1>/gi, ' ');

  const blocks = [];
  const re = /<(h2|h3|h4|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of cleaned.matchAll(re)) {
    const text = inlineToText(m[2], baseUrl);
    if (!text) continue;
    const tag = m[1].toLowerCase();
    blocks.push({ tag: tag === 'blockquote' ? 'quote' : tag, text });
  }
  return blocks;
}

/**
 * 用扁平正文做锚，筛掉不属于正文的块。
 * 尾部要求落在词边界上 —— 否则导航里的 "Login" 会命中正文的 "logins"。
 */
export function anchorToFlat(blocks, flat) {
  // 扁平正文里的 HTML 实体没有解码（上游给的 "Claude&#x27;s"），
  // 提取出来的块却是解码过的。不先拉齐，凡是带撇号的段落都对不上 ——
  // 2026-08-27 那两篇里，带实体的那篇覆盖率只有 28%，另一篇 85%。
  const flatS = squash(decode(flat));
  if (!flatS) return { kept: [], coverage: 0 };

  const kept = [];
  let covered = 0;
  for (const b of blocks) {
    const k = squash(b.text);
    if (k.length < 8) continue;                 // 太短的块判不准，宁可丢
    const at = flatS.indexOf(k);
    if (at < 0) continue;

    // 只有 <li> 需要查词边界：导航栏全是短 li，"Login" 会命中正文的 "logins"。
    // 段落和小标题不查 —— 扁平化把小标题直接粘在下一句上（"Getting started" 后面
    // 紧跟着 "To start using…"），查边界会把每一个小标题都误杀。
    if (b.tag === 'li' && k.length < 40) {
      const next = flatS[at + k.length];
      if (next && /[\p{L}\p{N}]/u.test(next)) continue;
    }

    kept.push(b);
    covered += k.length;
  }
  return { kept, coverage: covered / flatS.length };
}

/**
 * 给一篇博客还原正文结构。就地写入 blog.body / blog.bodyCoverage / blog.bodyError。
 * 永远不抛异常 —— 失败时 blog.body 留空，下游自动退回 blog.content。
 */
export async function restoreBody(blog) {
  const flat = String(blog.content || '');
  if (!blog.url || flat.length < 200) {
    blog.bodyError = !blog.url ? '没有原文链接' : '正文太短，不值得还原';
    return blog;
  }
  try {
    const html = await fetchText(blog.url);
    const { kept, coverage } = anchorToFlat(extractBlocks(html, blog.url), flat);
    if (coverage < MIN_COVERAGE) {
      blog.bodyError = `提取覆盖率仅 ${(coverage * 100).toFixed(0)}%，疑似站点改版，不采用`;
      return blog;
    }
    blog.body = kept;
    blog.bodyCoverage = Number(coverage.toFixed(3));
    blog.bodyLinks = kept.reduce((n, b) => n + (b.text.match(/\]\(https?:/g) || []).length, 0);
  } catch (err) {
    blog.bodyError = err.name === 'AbortError' ? '抓取超时' : err.message;
  }
  return blog;
}

/**
 * 把还原出的结构渲染成 markdown。没还原成功时退回扁平正文 ——
 * 退回也要解码实体，否则读者会看到 "Claude&#x27;s" 这种东西。
 */
export function bodyToMarkdown(blog) {
  if (!Array.isArray(blog.body) || !blog.body.length) return decode(String(blog.content || ''));
  const out = [];
  for (const b of blog.body) {
    // 素材里 ### 是「一个条目」这一级，博客内部的小标题必须再降一级，
    // 不然模型分不清哪些是条目、哪些是文章内部的分节
    if (b.tag === 'h2') out.push(`#### ${b.text}`);
    else if (b.tag === 'h3' || b.tag === 'h4') out.push(`##### ${b.text}`);
    else if (b.tag === 'li') out.push(`- ${b.text}`);
    else if (b.tag === 'quote') out.push(`> ${b.text}`);
    else out.push(b.text);
  }
  return out.join('\n\n');
}
