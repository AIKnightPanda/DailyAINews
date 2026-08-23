# AI Builders 简报归档

每天抓取 follow-builders 的中心 feed，存档原始数据，改写成中文简报，
并把可离线浏览的阅读器发布成 Artifact。

两条运行路径共用同一份代码：

| | 本地 launchd | 云端 Routine |
|---|---|---|
| 跑在哪 | 你的 Mac | Anthropic 云端沙箱 |
| 前提 | Mac 开机 + `claude` 已登录 | 无（GitHub 仓库可达即可） |
| 时间 | 每天 15:30 | 每天 05:30（UTC 21:30） |
| 产出 | 本地 `digests/` + `docs/index.html` | 仓库提交 → GitHub Pages 自动部署 |

## 目录

```
digests/
├── 2026-08-22.md          每期简报（带 frontmatter 元信息）
├── raw/2026-08-22.json    当期完整原始数据，期号 = feed 生成日
└── daily.log              本地运行日志（不入库）
docs/
└── index.html             构建产物：完整 HTML。GitHub Pages 的站点根目录，
                           也可以直接双击打开
viewer/
├── template.html          页面模板，唯一的样式真相源
└── artifact.html          构建产物：去掉外层骨架，留作手动发 Artifact 用
scripts/
├── daily.js               本地每日流程入口
├── archive.js             抓取并存档原始数据
├── extract.js             把原始数据压成模型可读的素材
├── build-viewer.js        扫描 digests/*.md 生成两份 HTML
├── digest-style.md        简报写作规范（改风格改这里）
└── routine.md             云端 Routine 的完整配置与 prompt
.artifact-url              私有 Artifact 快照地址（手动发布时用，Routine 不碰）
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

## 本地定时任务

launchd 任务 `com.pandax.daily-ai-digest`，每天 15:30。Mac 睡眠时错过会在唤醒后补跑。

```bash
launchctl list | grep daily-ai                                    # 查看状态
launchctl kickstart -p gui/$(id -u)/com.pandax.daily-ai-digest    # 立即跑一次
tail -f digests/launchd.log                                        # 看日志
```

改时间改 `~/Library/LaunchAgents/com.pandax.daily-ai-digest.plist` 的
`StartCalendarInterval`，然后 unload + load。卸载：

```bash
launchctl unload ~/Library/LaunchAgents/com.pandax.daily-ai-digest.plist
rm ~/Library/LaunchAgents/com.pandax.daily-ai-digest.plist
```

如果云端 Routine 跑得好，本地这套可以直接卸掉 —— 它需要 Mac 开机才有用。

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
Artifact 页面默认私有，只有你能看，除非你从页面的分享菜单主动分享。
