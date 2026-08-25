# DailyAI

每天自动生成一份中文 AI Builders 简报，发布成一个静态网页。

**看简报：** https://aiknightpanda.github.io/DailyAINews/

云端 Routine 每天 05:30 自动跑完全程并提交，本地机器不需要开着。

## 这个仓库里有什么

```
digests/          简报归档：每期一个 .md，raw/ 下是当期完整原始数据
docs/             构建产物，GitHub Pages 的站点根目录
viewer/           页面模板（template.html 是唯一的样式真相源）
scripts/          抓取、压缩、生成、构建的全部脚本
.claude/skills/   上游 skill follow-builders，当代码库用（不是当 skill 用）
sources/          信息源清单，见下方说明
legacy/           已停止运行的旧路线，留档用
```

**完整的系统说明在 [digests/README.md](digests/README.md)** —— 架构、期号规则、
token 是怎么省下来的、中英双视图、故障排查，都在那里。

## sources/sources.json 是什么

飞书路线时期的信息源控制台：AINews、5 个 newsletter、一批 KOL 的 X 账号、
四家官方博客。**当前没有任何代码读它** —— 现在的简报只消费 Zara 的中心 feed。

留着是当参考清单用的：哪天想扩信息源，这份名单是现成的起点。
不要被它误导成「改这里就能改信息源」，改信息源目前得改上游 feed 或自己写抓取。

## follow-builders-main.zip

上游 skill 的原始下载包，内容已解包在 `.claude/skills/follow-builders/`。
已在 `.gitignore` 里，只存在于本地，留作对照上游改动用。

## 本地怎么跑

```bash
node scripts/daily.js
```

幂等 —— feed 没更新就什么都不做。注意云端每天会提交，**本地改动前先 `git pull`**。
