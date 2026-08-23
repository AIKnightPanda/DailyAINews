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
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREPARE = join(ROOT, '.claude/skills/follow-builders/scripts/prepare-digest.js');
const RAW_DIR = join(ROOT, 'digests/raw');

const force = process.argv.includes('--force');

function fail(message) {
  console.log(JSON.stringify({ status: 'error', message }));
  process.exit(1);
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

  // 期号取 feed 生成日；缺失时退回今天
  const generatedAt = feed.stats?.feedGeneratedAt;
  const issue = (generatedAt ? new Date(generatedAt) : new Date())
    .toISOString()
    .slice(0, 10);

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
    digestExists: existsSync(join(ROOT, 'digests', `${issue}.md`))
  }));
}

main().catch(err => fail(err.message));
