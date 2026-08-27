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
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

// GitHub Actions 预抓的那份，只在窗口日期和本期对得上时才用 ——
// 隔夜的旧文件宁可不要，重抓一次也比配错一期强。
function readPending(issue) {
  const p = join(ROOT, 'digests/extra-pending.json');
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf-8'));
    if (String(j.windowUntil || '').slice(0, 10) !== issue) return null;
    if (!Array.isArray(j.items) || !Array.isArray(j.sources)) return null;
    return j;
  } catch {
    return null;   // 文件坏了当没有，走实时抓取
  }
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
  // 优先用 GitHub Actions 预抓好的那份：云端 Routine 的沙箱只放行 GitHub，
  // 自己抓这五个源一律 403（2026-08-26 实测 5/5）。Actions 的 runner 没这个限制，
  // 它在 21:10 UTC 抓完提交进仓库，这里直接取用。
  // 本地跑不受影响 —— 没有预抓文件（或日期对不上）就照旧自己抓。
  let extra = { items: [], sources: [] };
  let extraFrom = 'live';
  const pending = readPending(issue);
  if (pending) {
    extra = pending;
    extraFrom = 'prefetched';
  } else {
    try {
      // 传期号日期，让补充源的时间窗口和这一期对齐（否则会混进次日的文章）
      const r = await execFileAsync('node', [FETCH_EXTRA, `--until=${issue}`],
        { maxBuffer: 32 * 1024 * 1024, timeout: 90_000 });
      extra = JSON.parse(r.stdout);
    } catch (err) {
      extra = { items: [], sources: [], error: err.message };
    }
  }
  feed.extra = extra;

  // 抓取整体崩掉（脚本报错、超时、输出不是 JSON）和「源就是没新内容」是两回事：
  // 前者是 bug，必须喊出来，否则一次静默失败会被当成平静的一天糊弄过去。
  if (extra.error) {
    console.error(`[archive] 补充源抓取失败：${extra.error}`);
  }
  console.error(`[archive] 补充源来自${extraFrom === 'prefetched' ? ' GitHub Actions 预抓' : '本次实时抓取'}` +
    `，${extra.items?.length ?? 0} 条`);

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
    feedGeneratedAt: generatedAt,
    previousFeedGeneratedAt: previousFeedAt,
    stats: feed.stats,
    extra: {
      items: extra.items?.length ?? 0,
      source: extraFrom,          // prefetched = 用了 Actions 预抓的；live = 自己抓的
      error: extra.error || null,
      failed: (extra.sources || []).filter(x => x.status === 'error').map(x => x.name)
    },
    digestExists: existsSync(join(ROOT, 'digests', `${issue}.md`))
  }));
}

main().catch(err => fail(err.message));
