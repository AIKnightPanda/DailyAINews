#!/usr/bin/env node

// ============================================================================
// 每日流程：抓取 → 存档 → 生成简报 → 刷新阅读器
// ============================================================================
// 定时任务的入口。三步都是幂等的：feed 没更新就不会重复入档，
// 简报已存在就不会重新生成（除非 --force）。
//
// 用法:
//   node scripts/daily.js            正常跑一次
//   node scripts/daily.js --force    强制重抓并重写当期简报
//   node scripts/daily.js --no-llm   只抓取和存档，不调用 Claude 写简报
// ============================================================================

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { mkdir, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(ROOT, 'digests', 'daily.log');

const force = process.argv.includes('--force');
const noLlm = process.argv.includes('--no-llm');

// cron / launchd 的 PATH 很干净，可执行文件一律走绝对路径
const NODE = process.execPath;
const CLAUDE = process.env.CLAUDE_BIN || join(process.env.HOME, '.npm-global/bin/claude');

async function log(line) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
                `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const text = `[${stamp}] ${line}`;
  console.log(text);
  await mkdir(dirname(LOG), { recursive: true }).catch(() => {});
  await appendFile(LOG, text + '\n').catch(() => {});
}

// 把 Claude 的输出实时透传，方便 tail -f 日志看进度
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, [
      '-p', prompt,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read', 'Write', 'Bash',
      '--add-dir', ROOT
    ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

    let tail = '';
    const keep = (buf) => { tail = (tail + buf.toString()).slice(-2000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(tail);
      else reject(new Error(`claude 退出码 ${code}：${tail.slice(-500)}`));
    });
  });
}

async function main() {
  await log('=== 开始 ===');
  const failures = [];

  // ── 1. 抓取并存档 ──────────────────────────────────────────────
  const args = [join(ROOT, 'scripts/archive.js')];
  if (force) args.push('--force');
  const { stdout } = await execFileAsync(NODE, args, { maxBuffer: 8 * 1024 * 1024 });
  const result = JSON.parse(stdout.trim().split('\n').pop());

  if (result.status === 'error') throw new Error(result.message);

  const issue = result.issue;
  const mdPath = join(ROOT, 'digests', `${issue}.md`);

  if (result.status === 'archived') {
    await log(`已存档 ${issue}：${JSON.stringify(result.stats)}`);
  } else if (result.status === 'refreshed') {
    await log(`${issue} 的 feed 已更新（${result.previousFeedGeneratedAt} → ${result.feedGeneratedAt}），重写存档与简报`);
  } else {
    await log(`${issue} 已在档且 feed 未变，跳过抓取`);
  }

  // ── 2. 生成简报 ────────────────────────────────────────────────
  // feed 刷新过就必须重写简报，否则 md 会和 raw 对不上
  const needDigest = force || !existsSync(mdPath) || result.status === 'refreshed';

  if (noLlm) {
    await log('--no-llm，跳过简报生成');
  } else if (!needDigest) {
    await log(`${issue} 的简报已存在，跳过生成`);
  } else {
    // 素材由 extract.js 压缩后再喂给模型，写作规范和云端 Routine 共用一份。
    // 注意：本地这条路径**不做** Haiku 播客预压缩（那步在云端 Routine 里用子代理跑）。
    // 所以本地生成的简报，播客那节走的是定点采样，覆盖率会低一些 ——
    // extract.js 会在素材里如实标注覆盖率百分比。
    const prompt = [
      `你在为本地归档生成第 ${issue} 期 AI Builders 中文简报。无人值守，直接执行，不要提问。`,
      '',
      `1. 运行 \`node scripts/extract.js ${issue}\` 读取本期素材。这份输出已经压缩过，是你唯一需要读的内容 —— 不要去读 digests/raw/ 下的 JSON，那个文件很大。`,
      '2. 读 `scripts/digest-style.md`，严格按其中的规范写作。',
      `3. 用 Write 工具写入 \`digests/${issue}.md\`。`,
      '',
      '写完文件即可结束，不需要在回复里复述简报内容。'
    ].join('\n');

    await log(`调用 Claude 生成 ${issue} 的简报…`);

    // 原始数据已经安全落盘，简报生成失败不该让整次任务白跑。
    // 记录后继续，补生成用：node scripts/daily.js --force
    try {
      await runClaude(prompt);
      if (!existsSync(mdPath)) throw new Error('Claude 正常退出但没写出文件');
      await log(`简报已生成：digests/${issue}.md`);
    } catch (err) {
      failures.push(`简报生成失败：${err.message}`);
      await log(`⚠️  简报生成失败，原始数据已存档，稍后可用 --force 补生成`);
      await log(`⚠️  ${err.message}`);
    }
  }

  // ── 3. 刷新阅读器 ──────────────────────────────────────────────
  const build = await execFileAsync(NODE, [join(ROOT, 'scripts/build-viewer.js')]);
  await log(build.stdout.trim().split('\n')[0]);

  if (failures.length) {
    await log(`=== 完成，但有 ${failures.length} 项未成功 ===`);
    process.exitCode = 1;
  } else {
    await log('=== 完成 ===');
  }
}

main().catch(async err => {
  await log(`失败：${err.message}`);
  process.exit(1);
});
