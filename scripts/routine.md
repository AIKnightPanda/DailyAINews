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

   起一个 **model 为 haiku** 的子代理，交给它下面两件事：

     （a）若第 1 步 JSON 里的 stats.podcastEpisodes 不为 0：
     运行 `node scripts/extract.js <issue> --transcripts` 读取播客转录全文。
     通读全文后，为每一期播客提炼 700-1000 字中文要点，覆盖整期而不是只看开头：
     核心结论、关键数据（原样保留数字）、值得引用的原话（标明是原话）、
     以及嘉宾身份背景。不要写文风优美的散文，只要密度高的事实要点。
     用 Write 写入 `digests/summaries/<issue>.json`，格式：
     {"podcasts": ["第一期的要点…", "第二期的要点…"]}
     数组顺序必须和转录里的出现顺序一致。

     （b）运行 `node scripts/extract.js <issue>`，找到末尾的「补充源条目」一节。
     每条形如 `[E12] <来源> 标题 —— 背景说明`。做两件事：**筛选**和**翻译**，
     结果用 Write 写入 `digests/extra-zh/<issue>.json`：

       {
         "drop": [29, 34, 52],
         "sections": {"AI Twitter Recap": "X / Twitter 汇总", "…": "…"},
         "1": ["英文原标题前 18 个字符", "中文标题", "中文背景说明"],
         "2": ["...", "中文标题"]
       }

     **筛选**：`drop` 数组列出与 AI 无关的条目编号。聚合源里常混进纯生物医药、
     军事装备、生活类的条目，剔除掉。判断标准是「一个 AI builder 会不会关心」——
     AI 硬件、机器人、AI 政策都算相关；癌症疫苗、阅兵、种菜照片不算。
     宁可少剔也不要误伤，拿不准就留着。

     **翻译**：每个值是数组，**第一个元素是英文原标题的开头 18 个字符（原样照抄）**，
     第二个是中文标题，第三个是中文背景说明。按来源区别对待：

     - **OpenAI / Google DeepMind / Import AI**：标题和背景都译（三个元素）
     - **AINews / The Rundown AI**：**只译标题**（两个元素）——
       这两个源在版面上只显示标题，译背景是白花 token

     第一个元素是给脚本做编号对齐校验用的 —— 编号一旦错位，中文标题就会静默地
     挂到错误的链接上。校验不过时脚本会整条退回英文。

     **层级标题**：`sections` 里放板块 / 子版块 / 主题的译名（素材里形如
     `【AI Reddit Recap › /r/LocalLlama › 1. Qwen…】`）。中文版是英文版的提炼，
     层级标题也该是中文。subreddit 名这类专名保留原样。查不到译名就用原文。
     AINews 的 Twitter 板块用独立段落做分组（如「Agent Harnesses, Persistent
     Agents, and Enterprise MCP」），和 Reddit 的子版块同级，同样要译。

     背景说明按原意翻译，**不要自己发挥或补充原文没有的信息**。
     **不要输出任何 URL** —— 你也看不到 URL，脚本会按编号自己配回去。
     译不动的条目直接跳过，缺哪条就用英文原文。

   为什么用子代理：转录动辄 5 万字符，让主会话读它既贵又会稀释你写简报时的注意力。
   Haiku 单价是 Opus 的五分之一，而且这一步只是提取、筛选和翻译，不需要更强的模型。

   **这一步失败不要重试，直接进下一步。** 没有播客摘要时 extract.js 会退回定点采样
   并标明覆盖率；没有译文时补充源条目用英文原文。两种情况简报都照样出得来。

3. 读素材：

   node scripts/extract.js <issue>

   这份输出已经压缩过，是你唯一需要读的内容。上一步成功的话，播客那节会是
   通读全文提炼的要点；失败的话是采样片段，素材里会写明覆盖率百分比 ——
   **看到覆盖率标注就说明你只看到了一部分，不要对没看到的内容做任何推测。**

   素材末尾有「补充源条目」一节，形如 [E12] 标题，**只有编号、标题和背景，没有 URL**。
   你可以在正文里用 [E12] 引用，脚本会换成真链接；**不要自己写 URL，也写不出来**。

   绝对不要去读 digests/raw/ 下的 JSON —— 那个文件有 80KB 以上，读它纯属浪费。

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
播客是否走了 Haiku 压缩、译文是否生效、git 是否推送成功。
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

`archive.js` 优先读 GitHub Actions 预抓好的 `digests/extra-pending.json`
（云端沙箱只放行 GitHub，自己抓这五个源一律 403，详见 digests/README.md）；
没有预抓文件或日期对不上时才自己调 `fetch-extra.js`。抓的都是当期「标题 + 链接」：

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

### 预抓这条链路为什么要打三枪

`.github/workflows/fetch-extra.yml` 的 cron 是 `20 18,19,20 * * *`（UTC），
分别比 Routine 早 3h10 / 2h10 / 1h10。**GitHub 的 schedule 是尽力而为，没有 SLA。**
2026-08-27 设的单枪 `20 20 * * *` 就整个没触发 —— 工作流 state=active、文件在 main 上、
权限也对，运行记录里根本没有这一条。当晚 Routine 因此读到前一天的旧预抓文件，
08-27 期少了 5 条。三枪彼此独立，任何一枪成了就行。

三枪必须幂等，因为 `fetch-extra.js` 会把抓到的 URL 记进 `extra-seen.json` ——
第二次跑同样的源只会返回 0 条，会把第一枪的成果覆盖成空。所以工作流第一步先看
「今天是否已抓好」（`windowUntil` 和 `fetchedAt` 都是今天），抓好了整个 job 跳过。

`archive.js` 这一侧对预抓文件设了三道关，任何一道不过就退回实时抓取：

| 关 | 判据 | 不过怎么办 |
|---|---|---|
| 日期 | `windowUntil` 的日期 == 本期期号 | 静静走实时（本来就不是给这期的） |
| 新鲜度 | `fetchedAt` 在 24 小时内 | 记进 `extra.error` 并喊出来 |
| 自洽 | `items` 条数 == `sources` 里各 ok 源自报之和 | 同上 |

第三道是 08-27 那次的直接教训：那份文件被手工掏空过，`items` 是空的、
`sources` 却还写着「AINews 32 条」，日期又恰好对得上，于是一路静默到页面上少一块。
**别再手工编辑 `extra-pending.json`。** 要挪条目就改 `digests/raw/<期号>.json` 里的 `extra`。

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
