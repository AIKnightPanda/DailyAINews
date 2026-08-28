# 云端 Routine 配置

每天在 Anthropic 云端跑一次，产出简报并推送到仓库，由 GitHub Pages 自动部署。
与本地 launchd 那套共用同一份代码和写作规范。

- **调度**：`30 21 * * *`（UTC）= 北京时间每天 05:30
- **模型**：claude-sonnet-5
- **环境**：Default (`env_01U3tQcAWVYktAGcs5cijp6h`)
- **工具**：Bash, Read, Write, Edit, Glob, Grep, **Task（子代理，播客压缩要用）**
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

   再看 JSON 里的 `extra`，两件事都要看：
   - `extra.error` 不为 null —— 抓取脚本整个崩了。
   - `extra.failed` 非空 —— 有源抓失败了；**长度等于源总数就是全军覆没**。
     （2026-08-26 那次五个源全 403，而 `extra.error` 是 null，
     只判 error 就会把它当成「今天没新内容」放过去。）

   以上任一成立，都**不是**「今天没新内容」，而是抓取层出了问题：
   照常把简报做完（补充源是加分项，不该拖垮当期），但必须在最后的汇报里
   原样写出错误和失败的源名，并发一条通知。不要说成「本期无补充条目」。

2. 预处理（**用 Haiku 子代理，不要自己做**）：

   起一个 **model 为 haiku** 的子代理，任务是：

     读 `scripts/preprocess-style.md`，按其中的「任务 A」和「任务 B」执行，
     期号是 <issue>。两个任务彼此独立，其中一个失败不要重试，把另一个做完就交付。

   规范放在仓库文件里而不是写在这段 prompt 里，是为了能直接 git 改、本地也能复用。

   为什么用子代理：转录动辄 6 万字符，让主会话读它既贵又会稀释你写简报时的注意力。
   Haiku 单价低，而这一步只是提取、筛选和翻译，不需要更强的模型。

   **这一步失败不要重试，直接进下一步。** 没有播客摘要时 extract.js 会退回定点采样
   并标明覆盖率；没有译文时补充源条目用英文原文。两种情况简报都照样出得来。

3. 读素材：

   node scripts/extract.js <issue>

   这份输出已经压缩过，是你唯一需要读的内容。上一步成功的话，播客那节会是
   通读全文提炼的要点；失败的话是采样片段，素材里会写明覆盖率百分比 ——
   **看到覆盖率标注就说明你只看到了一部分，不要对没看到的内容做任何推测。**

   素材末尾有「补充源条目」一节，形如 [E12] 标题，**只有编号、标题和背景，没有 URL**。
   你可以在正文里用 [E12] 引用，脚本会换成真链接。这道隔离只管这一节 ——
   推文、博客原文、博客正文里的 [文字](URL) 都是内容，照抄照用。

   绝对不要去读 digests/raw/ 下的 JSON —— 那个文件有 100KB 以上，读它纯属浪费。

4. 写简报：读 scripts/digest-style.md，严格按其中的规范，
   用 Write 工具写入 digests/<issue>.md。

   注意素材末尾的「补充源条目」：正文里可以用 [E12] 这样的编号引用它们，
   但**不要逐条罗列** —— 下一步会由脚本自动在简报末尾生成「延伸阅读」一节。

5. 并入补充源，然后生成页面：

   node scripts/link-digest.js <issue> && node scripts/build-viewer.js

   link-digest.js 会把正文里的 [E<n>] 换成真链接，并在简报末尾追加「延伸阅读」。
   它是幂等的，重复跑不会重复追加。看它的输出：若报告「译文与原标题对不上」，
   说明上一步的编号错位了，在最后如实报告；若报告「N 个源抓取失败」，同样如实报告。

6. 提交并推送（注意要写明 refspec）：

   git add -A && git commit -m "digest: <issue>" && git push origin main

   推送成功后 GitHub Pages 会自动部署，不需要你再做别的发布动作。
   如果 push 报 403 或 "Claude doesn't have GitHub access"，说明 Claude GitHub App
   还没装到这个仓库上 —— 不要反复重试，直接在最后如实报告。

## 结束时

用两三句话报告：期号、本期条目数、补充链接条数与剔除条数、有没有源抓取失败、
博客正文还原了几篇、播客是否走了 Haiku 压缩、译文是否生效、git 是否推送成功。
任何一步失败都要明说，不要粉饰。
```

## ⚠️ 需要在 Routines 界面上改的配置

第 2 步要起子代理，所以**工具清单里必须勾上 `Task`**。没勾上的话这一步会失败，
简报仍然出得来（自动退回采样），但播客那节的覆盖率会掉回三分之一左右。

## 为什么这样设计能省 token

1. **feed 没更新就早退** —— 第 1 步就结束，几乎零消耗
2. **长素材交给便宜模型** —— 5 万字符的播客转录由 Haiku 通读后压成 1 千字要点，
   主会话读的是要点。省钱是其次，**主要是别让主模型写简报时的注意力被转录稀释**
3. **URL 完全不经过模型** —— 补充源的条目以 `[E<n>] 标题` 的形式进素材，
   **不带 URL**；模型只写编号，`link-digest.js` 再按编号配回真链接。
   所以**模型没有能力编造补充源的链接**，编号写错也只会退化成纯文本
4. **HTML 完全不经过模型** —— 页面拼装好直接 push，GitHub Pages 自动部署，
   发布环节零 token。
   所以**每天的消耗不随归档期数增长**，第 100 期和第 1 期花的 token 一样多

## 补充信息源

`archive.js` 优先读 GitHub Actions 预抓好的 `digests/extra-pending.json`，
没有或日期对不上时自己调 `fetch-extra.js` 实时抓。抓的都是当期「标题 + 链接」：

| 源 | 抓法 | 典型条数 |
|---|---|---|
| AINews (smol.ai) | 一期正文里的 `<li>` 条目，按 Twitter / Reddit 板块分组 | ~34 |
| Import AI | 一期正文里引用的论文与项目链接 | ~12 |
| OpenAI News | RSS 标题 + 官方一句话摘要 | 1-3 |
| Google DeepMind | 同上 | 0-1 |
| The Rundown AI | RSS 标题 | 1-2 |

只取标题和链接，**不抓正文** —— 试过抓正文页，OpenAI 直接 403，
DeepMind 抓下来的 15KB 文本大半是导航栏。RSS 是这几家唯一稳定的入口。

任何一个源失败只会让那一块缺失，不影响其他源，更不影响简报生成。
失败情况会写在「延伸阅读」一节末尾（中文）和 EN 视图底部，不会静悄悄消失。
**一条都没有时也会写一句**「本期补充源均正常，但没有新增条目」——
不然「安静的一天」和「管道断了」在页面上长得一模一样。

`digests/extra-seen.json` 记录已收过的 URL，避免同一条链接连着几天重复出现。

### 预抓与实时抓取

抓取有两条路，互为备份：

- **预抓** —— `.github/workflows/fetch-extra.yml`，cron `0 21 * * *`（UTC），
  比 Routine 早 30 分钟，抓完提交进仓库。一天只跑一次：`fetch-extra.js` 抓完会把
  URL 记进 `extra-seen.json`，同一天再跑只会返回 0 条，把上一次的成果覆盖掉。
- **实时抓取** —— 没有预抓文件、日期对不上、或文件没通过 `archive.js` 的三道关时，
  由 `archive.js` 自己抓。云端环境已放行这五个域名，这条路是通的。

`archive.js` 对预抓文件设了三道关，任何一道不过就退回实时抓取：

| 关 | 判据 | 不过怎么办 |
|---|---|---|
| 日期 | `windowUntil` 的日期 == 本期期号 | 静静走实时（本来就不是给这期的） |
| 新鲜度 | `fetchedAt` 在 24 小时内 | 记进 `extra.error` 并喊出来 |
| 自洽 | `items` 条数 == `sources` 里各 ok 源自报之和 | 同上 |

第三道是 2026-08-27 那次的教训：预抓文件被手工掏空过，`items` 是空的、
`sources` 却还写着「AINews 32 条」，日期又恰好对得上，于是一路静默到页面上少一块。
**别手工编辑 `extra-pending.json`。** 要挪条目就改 `digests/raw/<期号>.json` 里的 `extra`。

条目最终出现在两个地方，都不是独立的标签页：

- **中文简报末尾的「延伸阅读」一节** —— 由 `link-digest.js` 写进 `digests/<期号>.md`，
  所以 md 文件本身是自包含的，在 GitHub 上直接看也完整
- **EN 视图末尾的 Aggregators & official blogs 一节** —— 英文原标题

一个来源就是一组，分组和顺序都在 `scripts/groups.js`，中英两个视图共用这一份：

| 组 | 版面 |
|---|---|
| OpenAI / Google DeepMind | 标题 + 官方摘要 |
| Import AI | 期刊本身加粗排在最前，其后是它引用的一手来源 + Jack Clark 的点评 |
| The Rundown AI / AINews | **只有标题和链接** —— 条目多，加背景会把版面压垮 |

与 AI 无关的条目由 Haiku 在第 2 步筛掉（`drop` 数组）。

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
