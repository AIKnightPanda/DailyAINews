# AI Builders 简报归档

每天抓取 follow-builders 的中心 feed，存档原始数据，用 Claude 改写成中文简报，
并生成一个可离线浏览的阅读器。

## 目录

```
digests/
├── 2026-08-22.md          每期简报（带 frontmatter 元信息）
├── raw/2026-08-22.json    当期完整原始数据，期号 = feed 生成日
├── daily.log              每次运行的日志
└── launchd.log            定时任务的 stdout/stderr
viewer/
├── index.html             阅读器，双击即可打开
└── data.js                由 build-viewer.js 生成，请勿手改
scripts/
├── daily.js               每日流程入口（抓取 → 简报 → 刷新阅读器）
├── archive.js             抓取并存档原始数据
├── build-viewer.js        扫描 digests/*.md 生成 data.js
└── digest-prompt.md       写简报的提示词，想调风格就改这里
```

## 日常使用

```bash
node scripts/daily.js           # 跑一次（幂等，feed 没更新就什么都不做）
node scripts/daily.js --force   # 强制重抓并重写当期简报
node scripts/daily.js --no-llm  # 只抓取存档，不调用 Claude
```

看简报：直接双击 `viewer/index.html`，或用本地服务器：

```bash
python3 -m http.server 8770 --directory viewer
```

阅读器支持 `j`/`k` 或方向键切换期号，右上角切换明暗主题。

## 期号规则

期号取 **feed 的生成日**，不是运行日期。所以同一份 feed 跑多少次都只有一期。
如果同一天 feed 更新了（上游一天可能刷新多次），存档会更新到最新，
简报也会跟着重写，保证 `raw/<期号>.json` 和 `<期号>.md` 始终对应。

## 定时任务

已安装 launchd 任务 `com.pandax.daily-ai-digest`，每天 **15:30** 运行
（上游 feed 约在北京时间 14:30 更新，15:30 跑能拿到当天的）。
Mac 睡眠时错过的任务会在唤醒后补跑。

```bash
launchctl list | grep daily-ai                                    # 查看状态
launchctl kickstart -p gui/$(id -u)/com.pandax.daily-ai-digest    # 立即跑一次
tail -f digests/launchd.log                                        # 看日志
```

改时间：编辑 `~/Library/LaunchAgents/com.pandax.daily-ai-digest.plist` 的
`StartCalendarInterval`，然后重新加载：

```bash
launchctl unload ~/Library/LaunchAgents/com.pandax.daily-ai-digest.plist
launchctl load ~/Library/LaunchAgents/com.pandax.daily-ai-digest.plist
```

卸载：

```bash
launchctl unload ~/Library/LaunchAgents/com.pandax.daily-ai-digest.plist
rm ~/Library/LaunchAgents/com.pandax.daily-ai-digest.plist
```

## 前提：claude CLI 需要已登录

简报生成这一步会调用 `claude -p`。如果登录态过期，抓取和存档照常完成，
只有简报生成会跳过并在日志里留下警告 —— **原始数据不会丢**，
登录后用 `node scripts/daily.js --force` 补生成即可。

检查登录态：

```bash
claude -p "ok"
```

若报 `OAuth session expired`，在交互式终端里跑一次 `claude` 重新登录。
也可以改用 API key —— 在 plist 的 `EnvironmentVariables` 里加：

```xml
<key>ANTHROPIC_API_KEY</key>
<string>sk-ant-...</string>
```

## 数据流向

原始数据只从 `raw.githubusercontent.com` 单向拉取，不上传任何本地数据，
feed 本身也不需要 API key。唯一的外发是 `claude -p` 调用，
内容是当期公开的推文/博客/播客素材。
