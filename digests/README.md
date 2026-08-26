# AI Builders 简报归档

每天抓取 follow-builders 的中心 feed 和几个补充信息源，存档原始数据，
改写成中文简报，构建成一个静态页面由 GitHub Pages 发布。

**当前只有云端 Routine 在跑**，每天 05:30（UTC 21:30）执行，不依赖本地机器。
本地那条路径的代码还在，作为手动补跑和云端故障时的后备：

| | 云端 Routine（在用） | 本地 daily.js（后备） |
|---|---|---|
| 跑在哪 | Anthropic 云端沙箱 | 你的 Mac |
| 前提 | 无（GitHub 仓库可达即可） | Mac 开机 + `claude` 已登录 |
| 触发 | 每天 05:30 自动 | 手动，或装上 launchd 定时 |
| 产出 | 仓库提交 → Pages 自动部署 | 本地 `digests/` + `docs/index.html` |

## 目录

```
digests/
├── 2026-08-22.md          每期简报（带 frontmatter 元信息）
├── raw/2026-08-22.json    当期完整原始数据（含补充源链接），期号 = feed 生成日
├── summaries/<期号>.json  Haiku 通读播客全文后的要点缓存
├── extra-zh/<期号>.json   Haiku 对补充源的筛选与译文（按编号索引）
├── extra-seen.json        已收过的补充链接 URL，用于跨期去重
└── daily.log              本地运行日志（不入库）
docs/
├── index.html             构建产物：完整 HTML。GitHub Pages 的站点根目录，
│                          也可以直接双击打开
└── source/<期号>.json     该期英文原文，供页面「EN」视图按需加载
viewer/
├── template.html          页面模板，唯一的样式真相源
└── artifact.html          构建产物，不入库（Artifact 路线已弃用，留作备用）
scripts/
├── daily.js               本地每日流程入口
├── archive.js             抓取并存档原始数据
├── fetch-extra.js         抓补充源的「标题 + 链接」
├── link-digest.js         把补充源并进简报（换引用编号 + 追加延伸阅读）
├── groups.js              补充源的分组与顺序，中英两个渲染器共用这一份
├── extract.js             把原始数据压成模型可读的素材
├── build-viewer.js        扫描 digests/*.md 生成两份 HTML
├── digest-style.md        简报写作规范（改风格改这里）
├── routine.md             云端 Routine 的完整配置与 prompt
└── *.plist                本地 launchd 配置，当前未安装
legacy/                    已停止运行的旧路线，不参与任何自动流程
```

## 日常使用

```bash
node scripts/daily.js           # 跑一次（幂等，feed 没更新就什么都不做）
node scripts/daily.js --force   # 强制重抓并重写当期简报
node scripts/daily.js --no-llm  # 只抓取存档，不调用 Claude
```

看简报，三选一：

- 打开 GitHub Pages 站点（云端每天自动更新，手机上也能看，不需要登录）
- 双击 `docs/index.html`（同一份文件，单文件，不需要服务器）
- `python3 -m http.server 8770 --directory docs`

阅读器支持 `j`/`k` 或方向键切换期号，右上角切换明暗主题。

## 两种视图

页面右上角可在两种视图间切换：

- **中文** —— 模型写的简报，末尾附「延伸阅读」（补充源全部条目，中文标题 + 链接）
- **EN** —— feed 与补充源的全部原文，未经改写或删减

两者的关系要说清楚：**中文简报是有损的**。为了控制 token，`extract.js` 会对素材采样后
再交给模型，实测三期的覆盖率：

| 内容 | 覆盖率 |
|---|---|
| 推文 | 100%（全文） |
| 博客 | 100%（上限 3500 字符/篇，目前未触顶） |
| 播客转录 | 走 Haiku 预压缩时**通读全文**；退回采样时约 **33%** |

播客那部分现在默认由 Haiku 子代理通读整份转录后提炼要点，而不是盲采样几段 ——
同样的 token 预算，是「先理解再取舍」而不是碰运气切几刀。子代理没跑成时会自动
退回采样，并在素材里标注覆盖率百分比，简报里也不许写出「整期围绕…」这类
暗示读完全篇的说法。

**EN 视图给的永远是完整全文**，想核对某期播客时切过去读原文即可。

## 补充信息源

Zara 的 feed 只覆盖 builder 的 X / 博客 / 播客，`fetch-extra.js` 补上五个源：

| 源 | 内容 | 典型条数 | 背景说明来自哪里 |
|---|---|---|---|
| AINews (smol.ai) | 当期条目，按 Twitter/Reddit 板块分 | ~34 | 条目标题之后的正文（截 260 字符）|
| Import AI | 当期引用的论文与项目（arxiv/GitHub **一手来源**）| ~12 | 链接所在段落，多是 Jack Clark 的「Why this matters」（截 320 字符）|
| OpenAI News | 官方发布 | 1-3 | RSS 自带的官方一句话摘要 |
| Google DeepMind | 官方发布 | 0-1 | 同上 |
| The Rundown AI | 每日头条 | 1-2 | "摘要"其实是**另一条新闻的标题**，标为「另讯」|

**不抓正文页**，只用 RSS 里已有的内容。试过抓正文页：OpenAI 直接 403，
DeepMind 抓下来的 15KB 文本大半是导航栏。

**官方博客的摘要就是这么短，不是提示词写得不够。** OpenAI 的 RSS 只有 `description`
一个字段、没有 `content:encoded`；DeepMind 更短（81 字符）甚至为空。摘要短于 130
字符时会去文章页读 JSON-LD 补一份（DeepMind 实测 81 → 155 字符且更具体），但
**OpenAI 文章页返回 403**，补不了。让模型写长只能是编造，所以没有这么做。

官方博客和 Import AI 每条带背景说明；AINews 和 The Rundown 条目多，只给标题和链接。
AINews 每条常有 2 个来源链接，附加链接跟在标题后面。

条目最终出现在两个地方，不设独立标签页：

- **中文简报末尾的「延伸阅读」** —— `link-digest.js` 写进 `digests/<期号>.md`，
  所以 md 文件自包含，GitHub 上直接看也完整
- **EN 视图末尾的 Aggregators & official blogs** —— 英文原标题

分四组：官方博客（OpenAI + DeepMind）→ Import AI → AINews → The Rundown AI。
每组标题旁都挂着**出处链接**（官方站点地址存在数据层的 `sourceHome` 字段），
AINews 另挂当期汇总的原文地址。中英两个视图都一样。

AINews 的正文是三层结构（h1 板块 → h2 子版块 → h3 主题），早期只取了前两层，
主题分类全丢了；现在完整保留在 `section` 和 `topic` 两个字段里。

## 排版层级

延伸阅读一度直接复用简报正文的层级，结果分组标签和新闻大标题一样大（都是 21px），
层级整个塌掉。现在是四级：

| 级别 | 用途 |
|---|---|
| `##` h2 | 板块（一、二、三）|
| `###` h3 | 新闻条目标题 |
| `####` h4 | 延伸阅读的来源组 |
| `#####` h5 | 组内细分：博客名 / AINews 的板块，标题旁挂官方站点链接 |
| `######` h6 | AINews 的主题层（子版块 · 主题）|

配套修掉的渲染器问题：`####`/`#####`/`######` 曾被 `Math.min(level, 3)` 压成 h3，
分组标签因此和新闻大标题一样大；`*斜体*` 不支持（页面上裸露星号）；引用块不分
中性与警告，中性背景说明穿着橙色警告边框。现在只有 `⚠️` 开头的才是警告样式。

**链接清单不用 bullet + 下划线**，改成整行可点的条目：标题是主体，出处收成小号
mono 标签。标签文字由 URL 推断（推文显示 `@handle`，其他显示域名），点之前就知道
会跳到哪 —— 之前统一写「另一来源」，等于什么都没说。

页面中间有一栏**本期大纲**，从已渲染的 h2–h6 现扒，滚动时高亮当前小节，
长标题最多三行（否则大纲会被拉得很长）。窄于 1180px 收掉大纲保正文，
窄于 860px 期号索引转横向滚动。

## URL 为什么不可能被编造

这是这套补充源设计的核心约束。模型**从头到尾看不到补充源的 URL**：

1. `extract.js` 把条目以 `[E12] 标题` 的形式给模型，**不带 URL**
2. 模型想引用就写编号 `[E12]`，写不出链接
3. `link-digest.js` 按编号从 `digests/raw/` 里取真 URL 配回去

编号写错只会退化成纯文本，不会产生死链。中文标题和背景说明由 Haiku 翻译，
它同样只看得到编号、英文标题和英文背景，**看不到 URL**。

译文格式是 `{"12": ["英文标题前 18 字符", "中文标题", "中文背景"]}`，第一个元素做
**对齐校验** —— 编号一旦错位，中文标题就会静默地挂到错误的链接上，这是这套设计
唯一的真实风险。校验不过时整条退回英文，不会半中半英。

失败也可见：某个源抓不到时，EN 视图和简报里都会列出是哪个源、什么错误。

它补上了一个结构性缺口：此前博客源只有 Anthropic Engineering 和 Claude Blog 两家，
简报在博客维度上天然偏向 Anthropic。

英文原文按期存成独立文件按需加载，所以页面体积不随归档期数增长。
注意：双击本地 HTML 打开时，浏览器会禁止它读取同目录文件，EN 视图会提示改用站点地址。

## 期号规则

期号取 **feed 的生成日**，不是运行日期。所以同一份 feed 跑多少次都只有一期。
如果同一天 feed 更新了（上游一天可能刷新多次），存档会更新到最新，
简报也会跟着重写，保证 `raw/<期号>.json` 和 `<期号>.md` 始终对应。

云端 05:30 跑的时候，当天 feed（约 14:30 生成）还没出，所以拿到的是**前一天**那份。

## token 是怎么省下来的

1. **feed 没更新就早退** —— 第一步就结束，几乎零消耗
2. **素材预压缩** —— `extract.js` 把 80KB 原始 JSON 压到 31KB，播客转录只按比例采样几段
3. **HTML 完全不经过模型** —— 页面由脚本拼装后直接 push，GitHub Pages 自动部署，
   发布环节零 token

第 3 条最关键：**每天的消耗不随归档期数增长**，第 100 期和第 1 期花的 token 一样多。

> 早期方案用 Artifact 发布，但它有一道「未查看过线上版本就不许覆盖」的保护（这个保护是合理的）。
> 云端每天都是全新会话，必然撞上，只能先把线上副本整份读回来才能发布 ——
> 而那份 HTML 内嵌了所有期内容，会越读越大。改用 Pages 就完全绕开了这个问题。

## 本地 launchd（当前未安装）

移到云端后本地定时任务就卸掉了 —— 它需要 Mac 开机才有用。
`scripts/com.pandax.daily-ai-digest.plist` 保留作为后备，云端出问题时可以装回来：

```bash
cp scripts/com.pandax.daily-ai-digest.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.pandax.daily-ai-digest.plist
launchctl list | grep daily-ai    # 确认装上了
```

装回来之前记得先在云端把 Routine 停掉，否则两边会互相覆盖提交。
时间改 plist 里的 `StartCalendarInterval`。卸载是 `launchctl unload` 加 `rm`。

## 前提：本地路径需要 claude CLI 已登录

本地简报生成会调用 `claude -p`。登录态过期时，抓取和存档照常完成，
只有简报生成会跳过并在日志里留警告 —— **原始数据不会丢**，
登录后 `node scripts/daily.js --force` 补生成即可。

```bash
claude -p "ok"    # 报 OAuth session expired 就在交互式终端跑一次 claude 重新登录
```

云端 Routine 不受这个影响，它用的是自己的会话。

## 数据流向

原始数据只从 `raw.githubusercontent.com` 单向拉取，不上传任何本地数据，feed 本身不需要 API key。

注意仓库是**公开**的：`digests/` 和 `docs/` 里的内容任何人都能看到。
