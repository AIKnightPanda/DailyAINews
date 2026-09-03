#!/usr/bin/env node

// ============================================================================
// 把榜单和邮件合成一期灵感原始档
// ============================================================================
// 和 archive.js 同构，但期号规则**故意不一样**：
//
//   简报的期号 = 上游 feed 的 generatedAt（CLAUDE.md 里那条）
//   灵感的期号 = 运行当天（Asia/Shanghai）
//
// 因为灵感模块没有上游 feed，没有「这批内容是哪天生成的」这个概念，
// 只有「我这天收到了什么」。别照着 CLAUDE.md 那条规则改这里。
//
// 去重也放在这一层（而不是像 fetch-extra.js 那样放在抓取层），
// 这样抓取脚本保持无状态、可以随便重跑。
//
// 用法: node scripts/ideas-archive.js [--issue=YYYY-MM-DD] [--force]
// 输出: 一行 JSON 到 stdout
// ============================================================================

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BOARDS, NEWSLETTERS, SIDE_ORDER } from './idea-sources.js';
import { titleKey } from './lib/feedkit.js';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IDEAS = join(ROOT, 'ideas');
const SEEN = join(IDEAS, 'seen.json');
const SEEN_CAP = 2000;

const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const force = process.argv.includes('--force');

// 期号取 Asia/Shanghai 的当天。用 UTC 会让北京时间早上 8 点前跑出来的那一期
// 落到前一天，而这个模块就是每天早上看的。
function todayCN() {
  const d = new Date(Date.now() + 8 * 36e5);
  return d.toISOString().slice(0, 10);
}

const ISSUE = arg('issue') || todayCN();

// 预抓文件的三道关，判据和 archive.js 一致：日期对得上、抓取时间在 24 小时内、
// items 条数和 sources 自报的对得上。第三道是 2026-08-27 那次事故换来的 ——
// 一份被掏空的文件日期恰好对上，就这么被当成新鲜货用了。
function readPending(file, issue) {
  const p = join(IDEAS, file);
  if (!existsSync(p)) return null;

  let j;
  try { j = JSON.parse(readFileSync(p, 'utf-8')); }
  catch { return { reject: `${file} 不是合法 JSON` }; }

  if (String(j.windowUntil || '').slice(0, 10) !== issue) return null;
  if (!Array.isArray(j.items) || !Array.isArray(j.sources)) {
    return { reject: `${file} 结构不对（缺 items 或 sources）` };
  }

  const hours = (Date.now() - Date.parse(j.fetchedAt || 0)) / 36e5;
  if (!(hours >= -1 && hours < 24)) {
    return { reject: `${file} 是 ${Number.isFinite(hours) ? Math.round(hours) + ' 小时前' : '不明时间'}抓的，太旧` };
  }

  const claimed = j.sources.filter(s => s.status === 'ok')
    .reduce((n, s) => n + (Number(s.items) || 0), 0);
  if (claimed !== j.items.length) {
    return { reject: `${file} 自相矛盾：sources 报 ${claimed} 条，items 里只有 ${j.items.length} 条` };
  }
  return j;
}

// 先用预抓的，不行就自己实时抓。抓不出来也返回合法结构 —— 一路都不许抛。
async function collect(label, file, script) {
  const pending = readPending(file, ISSUE);
  if (pending && !pending.reject) {
    return { ...pending, from: 'prefetched', reject: null };
  }
  try {
    const r = await execFileAsync('node', [join(ROOT, 'scripts', script), `--until=${ISSUE}`],
      { maxBuffer: 32 * 1024 * 1024, timeout: 600_000 });
    const j = JSON.parse(r.stdout);
    return { ...j, from: 'live', reject: pending?.reject || null };
  } catch (err) {
    return {
      items: [], sources: [], from: 'failed',
      error: `${label}实时抓取失败：${String(err?.message || err).slice(0, 300)}`,
      reject: pending?.reject || null
    };
  }
}

// ── 去重 ──────────────────────────────────────────────────────────────────

function loadSeen() {
  if (!existsSync(SEEN)) return [];
  try { return JSON.parse(readFileSync(SEEN, 'utf-8')).entries || []; }
  catch { return []; }   // 状态文件坏了当空的用，最坏是重复几条
}

const sidePriority = x => SIDE_ORDER.indexOf(x.side || 'trend');

// 同一件事会从多个源撞进来（Show HN 发一次、Product Hunt 再发一次）。
// URL 相同靠 id 认，URL 不同、讲同一件事靠标题指纹认。
// 合流时留需求侧那条 —— 「有人明说想要」比「有人已经做了」更该被你看见，
// 被合掉的那条不丢，挂在 alsoFrom 里，简报里可以写「同时出现在 X 和 Y」。
function merge(items) {
  const byKey = new Map();
  for (const it of [...items].sort((a, b) => sidePriority(a) - sidePriority(b))) {
    const key = titleKey(it.title) || it.id;
    const hit = byKey.get(key) || byKey.get(it.id);
    if (hit) {
      (hit.alsoFrom ||= []).push({ source: it.source, url: it.url });
      continue;
    }
    byKey.set(key, it);
    byKey.set(it.id, it);
  }
  return [...new Set(byKey.values())];
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(join(IDEAS, 'raw'), { recursive: true });

  // 同一期重跑必须是**累加**，不是覆盖。
  // 第一版直接覆写，结果第二次跑（seen 已经把 98 条全滤掉）把当期归档清成了空。
  // 一天里可能跑好几次（预抓失败补跑、手动补跑），每次只该把新冒出来的条目追加进去。
  // --force 才是真正的重来。
  const rawPath = join(IDEAS, 'raw', `${ISSUE}.json`);
  let prior = null;
  if (!force && existsSync(rawPath)) {
    try { prior = JSON.parse(readFileSync(rawPath, 'utf-8')); } catch { prior = null; }
  }
  const priorItems = Array.isArray(prior?.items) ? prior.items : [];

  const boards = await collect('候选', 'candidates-pending.json', 'fetch-candidates.js');
  const inbox = await collect('邮件', 'inbox-pending.json', 'fetch-inbox.js');

  const fetched = [...(boards.items || []), ...(inbox.items || [])];

  const seen = loadSeen();
  const seenIds = new Set(seen.map(e => e.id));
  const seenTitles = new Set(seen.map(e => e.t).filter(Boolean));

  // 当期已归档的条目也参与去重，否则补跑时会把它们再算一遍
  for (const x of priorItems) {
    seenIds.add(x.id);
    const tk = titleKey(x.title);
    if (tk) seenTitles.add(tk);
  }

  const fresh = force ? fetched : fetched.filter(x => {
    const tk = titleKey(x.title);
    return !seenIds.has(x.id) && !(tk && seenTitles.has(tk));
  });

  const added = merge(fresh).sort((a, b) => {
    const s = sidePriority(a) - sidePriority(b);
    if (s) return s;
    const order = [...BOARDS, ...NEWSLETTERS].map(x => x.id);
    return order.indexOf(a.sourceId) - order.indexOf(b.sourceId);
  });

  // 每条编号 [I1]、[I2]…… 模型只看得到编号和标题，看不到 URL。
  // 编号在这里定死并写进原始档，link-ideas.js 按同一份编号配回链接。
  // 补跑时**已有条目的编号不动**，新条目从最大号往后接 —— 否则已经写好的
  // 简报里的 [I7] 会静默地指向另一条，这是最难发现的一种错。
  let next = priorItems.reduce((n, x) => Math.max(n, Number(String(x.ref || '').slice(1)) || 0), 0);
  added.forEach(x => { x.ref = `I${++next}`; });
  const items = [...priorItems, ...added];

  const sources = [
    ...(boards.sources || []).map(s => ({ ...s, group: 'board' })),
    ...(inbox.sources || []).map(s => ({ ...s, group: 'inbox' }))
  ];
  const errors = [boards.error, inbox.error, boards.reject, inbox.reject].filter(Boolean);

  const out = {
    issue: ISSUE,
    builtAt: new Date().toISOString(),
    from: { boards: boards.from, inbox: inbox.from },
    counts: {
      fetched: fetched.length,          // 本次抓到多少
      added: added.length,              // 本次新增多少
      kept: items.length,               // 当期累计多少
      dropped: fetched.length - added.length
    },
    errors,
    sources,
    items
  };
  await writeFile(rawPath, JSON.stringify(out, null, 2));

  // seen 只记 id 和标题指纹，不记内容 —— 它是去重用的，不是归档
  const merged = [
    ...added.map(x => ({ id: x.id, t: titleKey(x.title) || null, d: ISSUE })),
    ...seen
  ];
  const uniq = [...new Map(merged.map(e => [e.id, e])).values()].slice(0, SEEN_CAP);
  await writeFile(SEEN, JSON.stringify({ updatedAt: new Date().toISOString(), entries: uniq }, null, 2));

  const failed = sources.filter(s => s.status === 'error');
  for (const e of errors) console.error(`[ideas] ${e}`);
  console.error(`[ideas] ${ISSUE}：抓到 ${fetched.length} 条，新增 ${added.length} 条，当期累计 ${items.length} 条` +
    `（榜单${boards.from} / 邮件${inbox.from}）`);

  console.log(JSON.stringify({
    status: added.length ? 'ok' : (items.length ? 'nothing-new' : 'empty'),
    issue: ISSUE,
    fetched: fetched.length,
    added: added.length,
    kept: items.length,
    failed: failed.map(s => `${s.name}: ${s.error}`),
    errors
  }));
}

main().catch(err => {
  console.log(JSON.stringify({ status: 'error', issue: ISSUE, message: String(err?.message || err) }));
  process.exit(1);
});
