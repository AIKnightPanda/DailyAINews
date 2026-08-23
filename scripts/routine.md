# 云端 Routine 配置

每天在 Anthropic 云端跑一次，产出简报并更新 Artifact。与本地 launchd 那套共用同一份代码和写作规范。

- **调度**：`30 21 * * *`（UTC）= 北京时间每天 05:30
- **模型**：claude-sonnet-5
- **环境**：Default (`env_01U3tQcAWVYktAGcs5cijp6h`)
- **工具**：Bash, Read, Write, Edit, Glob, Grep, Artifact
- **仓库**：本仓库

管理入口：https://claude.ai/code/routines

## Prompt

```
无人值守的每日任务：为「建造者档案」抓取并发布 AI Builders 中文简报。
仓库已 clone 到工作目录，所有脚本只用 Node 内置模块，不需要 npm install。
直接执行，不要提问。

## 步骤

1. 抓取并存档：

   node scripts/archive.js

   它输出一行 JSON。读其中的 status 和 issue：
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

5. 更新 Artifact：先 cat .artifact-url 取出 URL，然后调用 Artifact 工具：
   - file_path: viewer/artifact.html
   - url: 刚才 cat 出来的那个 URL（必须传，否则会新建一个 artifact 而不是更新现有的）
   - favicon: 🗞️

6. 提交：

   git add -A && git commit -m "digest: <issue>" && git push

   push 失败最多重试一次，仍失败就如实报告，不要反复尝试。

## 结束时

用两三句话报告：期号、本期条目数、Artifact 是否更新成功、git 是否推送成功。
任何一步失败都要明说，不要粉饰。
```

## 为什么这样设计能省 token

1. **feed 没更新就早退** —— 第 1 步就结束，几乎零消耗
2. **素材预压缩** —— `extract.js` 把 80KB 原始 JSON 压到 31KB（播客转录只采样几段），模型读的是它而不是原文
3. **HTML 不经过模型** —— 页面由 `build-viewer.js` 拼装，Artifact 工具直接读文件发布。
   所以**每天的消耗不随归档期数增长**，第 100 期和第 1 期花的 token 一样多
