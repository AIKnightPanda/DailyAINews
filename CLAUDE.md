# 项目约定

每日 AI Builders 中文简报。**云端 Routine 每天 05:30 自动跑完并提交到 main。**

## 动手之前

- **先 `git pull`** —— 云端每天会提交，本地大概率落后
- 系统全貌看 [digests/README.md](digests/README.md)，云端配置看 [scripts/routine.md](scripts/routine.md)

## 几条容易踩的

- **期号 = feed 的 `generatedAt` 日期，不是运行日期。** 不要用文件 mtime 或今天的日期推断期号
- **`viewer/template.html` 是样式的唯一真相源。** `docs/index.html` 和 `viewer/artifact.html`
  都是 `build-viewer.js` 的产物，改它们会被下次构建覆盖
- **改了写作风格要改 `scripts/digest-style.md`** —— 本地和云端共用这一份
- **仓库是公开的**，`digests/`、`docs/`、`legacy/` 的内容任何人可见，别往里写私密信息
- **补充源的 URL 全程不经过模型** —— 模型只写 `[E<n>]` 编号，`scripts/link-digest.js`
  按编号配回真链接。别为了省事让模型直接写补充源的 URL，那等于放弃这道保险
- **零第三方依赖是硬约束** —— 只用 Node 标准库，这样云端沙箱不需要 `npm install`

## 不参与自动流程的目录

- `legacy/AInewssources.json` —— 飞书时期的信息源清单，当前无代码读取，留作参考。
  实际生效的补充源写在 `scripts/fetch-extra.js` 里
- `.claude/skills/follow-builders/` —— 上游 skill，**当代码库调用**（`prepare-digest.js`），
  不是当 skill 触发
