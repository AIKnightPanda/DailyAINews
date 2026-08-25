# 归档

放已经不再运行、但值得留档的东西。这个目录里的内容**不参与任何自动流程** ——
`build-viewer.js` 只扫 `digests/*.md`，不会碰这里。

## 2026-H1-feishu/ —— 飞书路线（2026-06-26 ~ 07-06）

本仓库的第一版。和现在这套是两个完全不同的系统：

|        | 飞书路线（已停）            | follow-builders 路线（当前）      |
|--------|---------------------------|---------------------------------|
| 信息源 | 自己抓 AINews / newsletter / 官方博客 | 消费 Zara 的 feed（X + 博客 + 播客） |
| 依赖   | 飞书 lark-mcp + Gmail 连接器 | 无外部连接器，只有 Node 标准库      |
| 运行   | Claude Desktop 定时任务，本地机器要开 | 云端 Routine，不依赖本地           |
| 输出   | 飞书云文档                  | GitHub Pages                     |

停用原因：依赖本地机器常开和一组 MCP 连接器，这正是后来要摆脱的。

里面是当时的 4 篇简报和那套系统的说明文档。文档里的飞书标识符已脱敏。

**信息源清单没有一起归档** —— `sources/sources.json` 留在原位，见根目录 README 的说明。

## artifact-url.txt

当前项目早期走过 Artifact 发布路线时的私有快照地址。改用 GitHub Pages 后不再需要，
放弃原因写在 [scripts/routine.md](../scripts/routine.md) 的「为什么不用 Artifact 发布」。
