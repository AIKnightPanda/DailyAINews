# 项目约定

两条并行的每日管线，**云端 Routine 每天 05:30 一起跑完并提交到 main**：

- **AI Builders 中文简报** —— `digests/` → `docs/index.html`
- **灵感档案** —— `ideas/` → `docs/ideas.html`，每天收「有人明说缺什么」和
  「今天上线了什么」，深挖评论后提炼成十条，每条附一段值不值得做的判断

## 动手之前

- **先 `git pull`** —— 云端每天会提交，本地大概率落后
- 系统全貌看 [digests/README.md](digests/README.md) 和 [ideas/README.md](ideas/README.md)，
  云端配置看 [scripts/routine.md](scripts/routine.md)

## 几条容易踩的

- **期号 = feed 的 `generatedAt` 日期，不是运行日期。** 不要用文件 mtime 或今天的日期推断期号。
  **灵感模块是例外**：它没有上游 feed，期号就是运行当天（Asia/Shanghai）
- **`viewer/template.html` 是样式的唯一真相源。** `docs/index.html`、`docs/ideas.html` 和
  `viewer/artifact.html` 都是构建产物，改它们会被下次构建覆盖。
  两个页面共用这一份模板，差异由注入的 `site` 字段描述（报头文案、EN 视图、互跳链接）
- **改了写作风格要改 `scripts/digest-style.md`**（简报）或 `scripts/ideas-style.md`（灵感）
  —— 本地和云端共用这两份
- **仓库是公开的**，`digests/`、`docs/`、`legacy/` 的内容任何人可见，别往里写私密信息
- **补充源的 URL 全程不经过模型** —— 模型只写 `[E<n>]` 编号，`scripts/link-digest.js`
  按编号配回真链接。别为了省事让模型直接写补充源的 URL，那等于放弃这道保险。
  灵感模块同理（`[I<n>]` + `link-ideas.js`），并且额外要求模型写一个
  **探针**（英文原标题的开头一段）—— 编号错位时靠它定位和拦截，
  2026-09-02 实测挡住过一次静默错配。细节见 [ideas/README.md](ideas/README.md)
- **灵感模块必须抓评论，`ideas-deepen.js` 这一步不能跳。** 竞品、已有方案、
  需求真伪的答案通常只在评论里。只读标题和摘要会把「iOS 早就内置了」的需求
  选成当日第一 —— 2026-09-02 真的犯过
- **灵感页上不出现没被读懂的条目。** 每条都要有模型写的一句话说明，
  没有说明的不展示（仍留在 `ideas/raw/` 里，页面上报个数字）。
  「Doop」「Hey guys」这种标题列出来等于没列
- **零第三方依赖是硬约束** —— 只用 Node 标准库，这样云端沙箱不需要 `npm install`

## 不参与自动流程的目录

- `legacy/AInewssources.json` —— 飞书时期的信息源清单，当前无代码读取，留作参考。
  实际生效的补充源写在 `scripts/fetch-extra.js` 里
- `.claude/skills/follow-builders/` —— 上游 skill，**当代码库调用**（`prepare-digest.js`），
  不是当 skill 触发
- `scripts/fetch-extra.js` 里有一份和 `scripts/lib/feedkit.js` 重复的解析工具。
  **没有合并**：那条路径每天在跑，为一个新模块去动它不划算。都是纯函数，
  重复最坏只是代码冗余，不会像 `groups.js` 那样造成两边配置漂移
