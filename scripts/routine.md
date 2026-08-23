# 云端 Routine 配置

每天在 Anthropic 云端跑一次，产出简报并推送到仓库，由 GitHub Pages 自动部署。
与本地 launchd 那套共用同一份代码和写作规范。

- **调度**：`30 21 * * *`（UTC）= 北京时间每天 05:30
- **模型**：claude-sonnet-5
- **环境**：Default (`env_01U3tQcAWVYktAGcs5cijp6h`)
- **工具**：Bash, Read, Write, Edit, Glob, Grep
- **发布**：`git push` → GitHub Pages 自动部署（不经过 Artifact）
- **仓库**：本仓库

管理入口：https://claude.ai/code/routines

## Prompt

```
无人值守的每日任务：为「建造者档案」抓取并发布 AI Builders 中文简报。
仓库已 clone 到工作目录，所有脚本只用 Node 内置模块，不需要 npm install。
直接执行，不要提问。

## 步骤

1. 对齐分支并抓取（两件事放在同一条命令里）：

   git fetch origin && git checkout -B main origin/main && node scripts/archive.js

   前两条是必需的：沙箱的 checkout 默认处于 detached HEAD，本地 main 分支会停在旧提交，
   不先对齐的话最后一步 push 会被以 non-fast-forward 拒绝。

   archive.js 输出一行 JSON。读其中的 status 和 issue：
   - 若 status 是 skipped 且 digests/<issue>.md 已存在 —— 立即结束整个任务。
     不要读素材、不要写文件、不要提交，直接回复「feed 未更新，本次无需操作」。
   - 其他情况（archived / refreshed，或该期 md 尚不存在）—— 继续下一步。

2. 读素材：

   node scripts/extract.js <issue>

   这份输出已经压缩过，是你唯一需要读的内容。
   绝对不要去读 digests/raw/ 下的 JSON —— 那个文件有 80KB 以上，读它纯属浪费。

3. 写简报：读 scripts/digest-style.md，严格按其中的规范，
   用 Write 工具写入 digests/<issue>.md。

4. 生成页面：

   node scripts/build-viewer.js

5. 提交并推送（注意要写明 refspec）：

   git add -A && git commit -m "digest: <issue>" && git push origin main

   推送成功后 GitHub Pages 会自动部署，不需要你再做别的发布动作。
   如果 push 报 403 或 "Claude doesn't have GitHub access"，说明 Claude GitHub App
   还没装到这个仓库上 —— 不要反复重试，直接在最后如实报告。

## 结束时

用两三句话报告：期号、本期条目数、git 是否推送成功。
任何一步失败都要明说，不要粉饰。
```

## 为什么这样设计能省 token

1. **feed 没更新就早退** —— 第 1 步就结束，几乎零消耗
2. **素材预压缩** —— `extract.js` 把 80KB 原始 JSON 压到 31KB（播客转录只采样几段），模型读的是它而不是原文
3. **HTML 完全不经过模型** —— 页面由 `build-viewer.js` 拼装成 `docs/index.html` 后直接 push，
   GitHub Pages 自动部署，发布环节零 token。
   所以**每天的消耗不随归档期数增长**，第 100 期和第 1 期花的 token 一样多

## 沙箱的 detached HEAD 坑

云端沙箱 clone 出来的工作区处于 detached HEAD 状态：HEAD 指向最新提交，
但本地 `main` 分支 ref 停在更早的提交上。这时 `git push origin main`
推的是那个陈旧的分支 ref，会被以 non-fast-forward 拒绝。

实测确认（2026-08-23）：

```
HEAD detached from refs/heads/main
main   bd298fa [origin/main]      ← 落后
HEAD   264792e                    ← 实际内容
```

所以每次运行的第一条命令必须是 `git fetch origin && git checkout -B main origin/main`，
对齐之后 dry-run 才会返回 `Everything up-to-date`。

## 为什么不用 Artifact 发布

Artifact 有一道「未查看过当前线上版本就不许覆盖」的保护，这个保护是合理的 ——
它防止一个没看过线上内容的会话盲目覆盖别人的东西。但云端 Routine 每天都是全新会话，
必然撞上，按官方流程只能先把线上副本整份读回来再发布，而那份 HTML 内嵌了所有期内容，
会越读越大（今天 71KB，几十期后是几百 KB）。改用 Pages 就完全绕开了这个矛盾。
`viewer/artifact.html` 仍会生成，留作需要时手动发布私有快照用。

## 沙箱的 git 状态（踩过的坑）

云端沙箱把目标 commit 检出成**游离 HEAD**，而本地分支 `main` 停在缓存克隆时的旧位置：

```
HEAD detached from refs/heads/main
HEAD            = <最新 commit>
refs/heads/main = <旧 commit>
```

直接 `git push origin main` 推的是那个陈旧的分支引用，会被判 non-fast-forward 而拒绝。
所以 prompt 第 0 步必须先 `git fetch origin && git checkout -B main origin/main`，
实测之后 `git push --dry-run origin main` 返回 `Everything up-to-date`。
