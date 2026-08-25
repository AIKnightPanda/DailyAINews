# AI Builders 简报归档

每天抓取 follow-builders 的中心 feed，存档原始数据，改写成中文简报，
构建成一个静态页面由 GitHub Pages 发布。

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
├── raw/2026-08-22.json    当期完整原始数据，期号 = feed 生成日
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

## 中文 / EN 双视图

页面右上角可在两种视图间切换：

- **中文** —— 模型提炼过的简报
- **EN** —— feed 里的英文原文，未经改写或删减

两者的关系要说清楚：**中文简报是有损的**。为了控制 token，`extract.js` 会对素材采样后
再交给模型，实测三期的覆盖率：

| 内容 | 覆盖率 |
|---|---|
| 推文 | 100%（全文） |
| 博客 | 100%（上限 3500 字符/篇，目前未触顶） |
| 播客转录 | **33%**（开头 4000 + 三段各 3000 字符采样） |

所以播客那部分，中文简报只看到约三分之一。**EN 视图给的是完整全文**，
想深入某期播客时切过去读原文即可 —— 这部分数据一直都完整存在归档里，
只是此前没有展示出来。

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
