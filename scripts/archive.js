#!/usr/bin/env node

// ============================================================================
// 抓取并归档一期原始内容
// ============================================================================
// 调用 skill 的 prepare-digest.js 取回 feed，按 feed 的 generatedAt 日期存档。
// 用 feed 日期而非运行日期做期号，同一份 feed 跑多次不会重复入档。
//
// 用法: node scripts/archive.js [--force]
// 输出: 一行 JSON 到 stdout，供上层脚本判断是否需要生成简报
// ============================================================================

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { restoreBody } from './blog-body.js';

const execFileAsync = promisify(execFile);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREPARE = join(ROOT, '.claude/skills/follow-builders/scripts/prepare-digest.js');
const FETCH_EXTRA = join(ROOT, 'scripts/fetch-extra.js');
const RAW_DIR = join(ROOT, 'digests/raw');

const force = process.argv.includes('--force');

function fail(message) {
  console.log(JSON.stringify({ status: 'error', message }));
  process.exit(1);
}

// 期号总比运行日早一天：feed 当天下午（约 06:4x UTC）出刊，Routine 次日
// 凌晨（21:30 UTC）才跑。所以「今天」这一期本来就不该存在，上界不含今天。
function todayCN() {
  return new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10);
}

function nextDay(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// 早退本身是对的，但没人知道漏了一期 —— 2026-09-06 上游缺席一次、当晚 22:54Z
// 才补发，比 Routine 晚 84 分钟。Routine 照常判 skipped 早退，而第二天它拿的是
// 届时上游最新的那一份：上游一恢复正常节奏，缺的那期就再也没人来抓了。
// 所以每次都算一遍从最新一期的次日到昨天之间缺了哪几期，交给上层喊出来。
// 上游偶尔真的不出刊，这里分辨不了，宁可误报也别再静默漏一期。
function missingIssues(issue) {
  let have;
  try {
    have = new Set(
      readdirSync(join(ROOT, 'digests'))
        .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .map(f => f.slice(0, 10))
    );
  } catch {
    return [];
  }
  if (!have.size) return [];

  const latest = [...have].sort().pop();
  const today = todayCN();
  const gaps = [];
  // 正在做的这一期不算缺 —— skipped 且 md 尚不存在时，上层会照常把它做完
  for (let d = nextDay(latest); d < today; d = nextDay(d)) {
    if (!have.has(d) && d !== issue) gaps.push(d);
  }
  return gaps;
}

// GitHub Actions 预抓的那份。要过三关才敢用：窗口日期对得上本期、抓取时间在
// 24 小时内、items 条数和 sources 自报的对得上。三关都是 2026-08-27 那次事故
// 换来的 —— 一份隔夜的、被手工掏空的文件日期恰好对上，就这么被当成新鲜货用了。
// 前两关不算故障（本来就该退回实时抓取），第三关是文件坏了，要喊出来。
function readPending(issue) {
  const p = join(ROOT, 'digests/extra-pending.json');
  if (!existsSync(p)) return null;

  let j;
  try {
    j = JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return { reject: '预抓文件不是合法 JSON' };
  }

  if (String(j.windowUntil || '').slice(0, 10) !== issue) return null;
  if (!Array.isArray(j.items) || !Array.isArray(j.sources)) {
    return { reject: '预抓文件结构不对（缺 items 或 sources）' };
  }

  const hours = (Date.now() - Date.parse(j.fetchedAt || 0)) / 36e5;
  if (!(hours >= -1 && hours < 24)) {
    return { reject: `预抓文件是 ${Number.isFinite(hours) ? Math.round(hours) + ' 小时前' : '不明时间'}抓的，太旧` };
  }

  const claimed = j.sources
    .filter(s => s.status === 'ok')
    .reduce((n, s) => n + (Number(s.items) || 0), 0);
  if (claimed !== j.items.length) {
    return { reject: `预抓文件自相矛盾：sources 报 ${claimed} 条，items 里只有 ${j.items.length} 条` };
  }

  return j;
}

async function main() {
  if (!existsSync(PREPARE)) fail(`找不到 skill 脚本: ${PREPARE}`);

  // prepare-digest.js 输出的 JSON 很大（~100KB），要放开 maxBuffer
  const { stdout } = await execFileAsync('node', [PREPARE], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000
  });

  const feed = JSON.parse(stdout);
  if (feed.status !== 'ok') fail(`feed 状态异常: ${feed.status}`);

  // 上游的改写指令不是内容，不入档 —— 7.2KB，逐日一字不变，
  // 存 365 天就是 2.6MB 的同一份东西。要看它去上游仓库。
  delete feed.prompts;

  // 期号取 feed 生成日；缺失时退回今天
  const generatedAt = feed.stats?.feedGeneratedAt;
  const issue = (generatedAt ? new Date(generatedAt) : new Date())
    .toISOString()
    .slice(0, 10);

  // 补充信息源（AINews / Import AI / 官方博客）—— 纯链接墙，不抓正文。
  // 它是加分项不是必需品：抓不到就带着空清单继续，绝不让当期简报出不来。
  //
  // 优先用 GitHub Actions 在 21:00 UTC 预抓好的那份，没有或日期对不上就自己实时抓。
  // 两条路都通：云端环境已放行这五个域名（2026-08-28 实测 5/5）。
  let extra = { items: [], sources: [] };
  let extraFrom = 'live';
  const pending = readPending(issue);
  if (pending && !pending.reject) {
    extra = pending;
    extraFrom = 'prefetched';
    // **预抓里某个源报 error，不等于今天它就该是空的。** 预抓跑在 GitHub Actions 上，
    // 出口是机房 IP，被 Cloudflare 挑战是常事 —— 2026-09-04、09-05 连着两天
    // substack 镜像 403，而同一时刻本地 200。Routine 的出口不一样，值得再试一次。
    // 之前这里不补抓，一份「日期对得上、格式也合法」的预抓文件就把那个源
    // 静默吞掉了，档案里只留下一行警告。
    //
    // 只补抓失败的那几个：成功的源 URL 已经记进 extra-seen，重跑只会返回 0 条，
    // 反而把预抓的成果盖掉。
    const broken = pending.sources.filter(x => x.status === 'error' && x.id).map(x => x.id);
    if (broken.length) {
      console.error(`[archive] 预抓里 ${broken.join('、')} 抓取失败，实时补抓这几个源`);
      try {
        const r = await execFileAsync('node',
          [FETCH_EXTRA, `--until=${issue}`, `--only=${broken.join(',')}`],
          { maxBuffer: 32 * 1024 * 1024, timeout: 90_000 });
        const patch = JSON.parse(r.stdout);
        extra = {
          ...pending,
          sources: pending.sources.map(x => patch.sources.find(y => y.id === x.id) || x),
          items: pending.items.concat(patch.items || [])
        };
        const back = (patch.sources || []).filter(x => x.status === 'ok').map(x => x.name);
        extraFrom = back.length ? 'prefetched+retry' : 'prefetched';
        console.error(back.length
          ? `[archive] 补抓救回 ${back.join('、')}，新增 ${(patch.items || []).length} 条`
          : '[archive] 补抓仍然失败，按预抓的结果出稿');
      } catch (err) {
        console.error(`[archive] 补抓没跑起来：${err.message}`);
      }
    }
  } else {
    if (pending?.reject) console.error(`[archive] ${pending.reject}，改为实时抓取`);
    try {
      // 传期号日期，让补充源的时间窗口和这一期对齐（否则会混进次日的文章）
      const r = await execFileAsync('node', [FETCH_EXTRA, `--until=${issue}`],
        { maxBuffer: 32 * 1024 * 1024, timeout: 90_000 });
      extra = JSON.parse(r.stdout);
    } catch (err) {
      extra = { items: [], sources: [], error: err.message };
    }
    // 预抓文件被拒 + 实时又失败 = 这一期彻底没补充源。两个原因都得留在档里，
    // 否则事后只看得到实时抓取那条报错，查不出预抓那步为什么没顶上。
    if (pending?.reject) {
      extra.error = extra.error ? `${pending.reject}；实时抓取也失败：${extra.error}` : pending.reject;
    }
  }
  feed.extra = extra;

  // 抓取整体崩掉（脚本报错、超时、输出不是 JSON）和「源就是没新内容」是两回事：
  // 前者是 bug，必须喊出来，否则一次静默失败会被当成平静的一天糊弄过去。
  if (extra.error) {
    console.error(`[archive] 补充源抓取失败：${extra.error}`);
  }
  const FROM = { prefetched: ' GitHub Actions 预抓', 'prefetched+retry': '预抓 + 实时补抓', live: '本次实时抓取' };
  console.error(`[archive] 补充源来自${FROM[extraFrom] || extraFrom}，${extra.items?.length ?? 0} 条`);

  // 博客正文：feed 给的是一堵没有分段、没有小标题、没有任何链接的墙 ——
  // 文章里引用的 YouTube 演示、文档页、评测报告那些**属于内容本身**的链接全丢了。
  // 回原文页把结构取回来；抓不到就留着扁平正文，不影响出刊。
  if (Array.isArray(feed.blogs) && feed.blogs.length) {
    await Promise.all(feed.blogs.map(b => restoreBody(b)));
    const done = feed.blogs.filter(b => b.body?.length).length;
    const links = feed.blogs.reduce((n, b) => n + (b.bodyLinks || 0), 0);
    const bad = feed.blogs.filter(b => b.bodyError)
      .map(b => '；' + b.name + '「' + String(b.title).trim() + '」未还原：' + b.bodyError)
      .join('');
    console.error(`[archive] 博客正文还原 ${done}/${feed.blogs.length} 篇，找回正文链接 ${links} 个${bad}`);
  }

  await mkdir(RAW_DIR, { recursive: true });
  const rawPath = join(RAW_DIR, `${issue}.json`);

  // 同一天 feed 可能刷新多次。仅当内容确实没变时才跳过；
  // 变了就更新存档并回报 refreshed，让上层知道简报需要跟着重写。
  let previousFeedAt = null;
  if (existsSync(rawPath) && !force) {
    try {
      previousFeedAt = JSON.parse(await readFile(rawPath, 'utf-8')).stats?.feedGeneratedAt ?? null;
    } catch {
      previousFeedAt = null; // 存档损坏，当作没有，重新写
    }

    if (previousFeedAt && previousFeedAt === generatedAt) {
      console.log(JSON.stringify({
        status: 'skipped',
        issue,
        reason: 'feed 未更新，原始数据已是最新',
        missing: missingIssues(issue),
        rawPath
      }));
      return;
    }
  }

  await writeFile(rawPath, JSON.stringify(feed, null, 2));

  console.log(JSON.stringify({
    status: previousFeedAt ? 'refreshed' : 'archived',
    issue,
    rawPath,
    missing: missingIssues(issue),
    feedGeneratedAt: generatedAt,
    previousFeedGeneratedAt: previousFeedAt,
    stats: feed.stats,
    extra: {
      items: extra.items?.length ?? 0,
      source: extraFrom,          // prefetched = 用了 Actions 预抓的；live = 自己抓的；
                                  // prefetched+retry = 预抓有源失败，那几个是实时补回来的
      error: extra.error || null,
      failed: (extra.sources || []).filter(x => x.status === 'error').map(x => x.name)
    },
    digestExists: existsSync(join(ROOT, 'digests', `${issue}.md`))
  }));
}

main().catch(err => fail(err.message));
