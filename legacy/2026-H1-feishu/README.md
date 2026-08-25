> ⚠️ **本文档已归档，描述的系统自 2026-07-06 起停止运行。**
> 当前生效的是 follow-builders 路线，见仓库根目录 [README.md](../../README.md)。
> 原文中的飞书 wiki 地址、space_id、父节点 token 和 app_id 已在归档时替换为占位符
> （仓库是公开的）。真实值可从 git 历史中找回。

# DailyAI 自动简报系统

每天 5:30 自动抓取前一天 AI 领域重要资讯，**新建一篇飞书云文档**，并自动归档到知识库 DailyAI 节点下（按日期排序）。

## 输出位置

**飞书知识库节点：DailyAI**
- 地址：<你的飞书 wiki 节点地址>
- wiki space_id：`<space_id>`
- 父节点 token：`<父节点 token>`

每天生成一篇独立文档，命名为 `AI 简报 YYYY-MM-DD`，自动移动到 DailyAI 节点下。标题带日期，可在知识库里按日期排序。

## 内容结构

每篇文档分三个类别，每条目内嵌信息来源（名称 / @账号 + 链接）：

| 类别 | 内容 |
|------|------|
| 新产品/技术进展 | 新模型、技术突破、产品更新、开源发布 |
| 重要观点 | KOL 见解、行业判断、值得关注的讨论 |
| 重要事件 | 融资、政策法规、组织变化、行业动态 |

每个类别最多 15 条，按重要性优先；某类别无内容则写「昨日暂无相关动态」。

## 信息来源（本地管理）

配置文件：`sources/sources.json` —— **这是唯一的控制台，定时任务每次运行都会读取它**。

来源结构：

- **主来源 AINews**（`primary_source`）：直接抓公开存档 `https://news.smol.ai/issues/`，取当日那一期。聚合了 X/Twitter+Reddit+Discord，单期 8–15 条，是简报主体。**无需经 Gmail。**
- **AI Valley**（`gmail_newsletters`）：Gmail 索引 + 公开网页 `https://www.theaivalley.com/` 取正文
- **网页 Newsletter**（`newsletters`）：The Batch、Import AI、Ben's Bites、The Rundown AI、Lenny's
- **X 账号**（`x_accounts`）：见下方说明（暂不可用）
- **官方博客**（`official_blogs`）：Anthropic、OpenAI、DeepMind、Meta AI

### 正文抓取方式（高效、省 token）

- **AINews**：直接 WebFetch `news.smol.ai/issues/` 当日那期，逐条拆开。干净、可解析、一次拿全。
- **AI Valley**：Gmail 只做索引（拿 subject + messageId，用于 Gmail 链接 `https://mail.google.com/mail/u/0/#all/<messageId>`），正文抓公开网页版；抓不到再退回 `get_thread` 取 plaintext（不取 html）。

### 文档末尾的「信息源统计」

每篇文档末尾会列出本次检索结果：共检索几个源、命中/未命中/不可用各几个、合计多少条，并逐条列出每个 enabled 来源的命中情况。

### 关于覆盖度（X 账号 / 网页源）

- **X 账号目前不可用**：Claude 连接器注册表中**没有可用的 X/Twitter MCP**（X 官方 API 付费且严格限制）。这些账号会标为「不可用」。好在 AINews 已聚合 X/Twitter + Reddit + Discord 的热门讨论，覆盖大部分 X 重要动态。若日后要补 X 原声，可考虑用 Exa（Web Search MCP）通过网页搜索捞取，或等出现可用的 X 连接器。
- **网页 Newsletter / 博客**：营销站点常为客户端渲染，WebFetch 可能抓不到正文，抓不到则记「未命中」。建议优先依赖 AINews（聚合度最高）+ Gmail 源。

### 如何添加 / 删除 / 禁用信息源

直接编辑 `sources/sources.json`：

- **临时禁用**：把对应条目的 `"enabled"` 改为 `false`（不用删除）
- **新增 Gmail 邮件源**：在 `gmail_newsletters` 里加一条 `{ "name": "名称", "sender": "发件人邮箱", "enabled": true }`
- **新增网页 Newsletter / 博客**：在对应数组里加 `{ "name": "名称", "url": "网址", "enabled": true }`
- **新增 X 账号**：在 `x_accounts` 里加 `{ "handle": "@账号", "name": "姓名", "enabled": true }`

保存即可，下次运行自动生效，无需改定时任务。

## 依赖的连接器与工具

1. **飞书 lark-mcp** —— 建文档 + 归档到 wiki，需在 `-t` 工具白名单里启用：
   - `docx.builtin.import`（建文档）
   - `wiki.v2.spaceNode.moveDocsToWiki`（移动到知识库）
   - `wiki.v2.spaceNode.create`、`wiki.v2.space.getNode`（wiki 操作）
2. **Gmail 连接器** —— 读取 AINews / AI Valley 订阅邮件（只读搜索权限即可）

### Claude Desktop 飞书 MCP 配置

```json
{
  "mcpServers": {
    "lark-mcp": {
      "command": "npx",
      "args": [
        "-y", "@larksuiteoapi/lark-mcp", "mcp",
        "-a", "<你的飞书 app_id>",
        "-s", "<your_app_secret>",
        "--oauth",
        "--token-mode", "user_access_token",
        "-t", "preset.default,docx.builtin.import,wiki.v2.space.getNode,wiki.v2.spaceNode.create,wiki.v2.spaceNode.moveDocsToWiki"
      ]
    }
  }
}
```

> ⚠️ `-t` 后必须是「一个」逗号连接的字符串（数组里的单个元素），不要拆成多行，否则会报 `too many arguments for 'mcp'`。
> ⚠️ App Secret 请勿明文存储在此文件中，从飞书开发者后台获取后直接填入 Claude Desktop 配置；如已泄露请到后台重置。
> ⚠️ 飞书应用需开通 `wiki:wiki` 权限范围，且账号对 DailyAI 知识空间有编辑权限。

## 定时任务

- 任务 ID：`daily-ai-briefing`
- 执行时间：每天 05:30
- 流程：读取 `sources/sources.json` → 抓取昨天资讯（含 Gmail）→ 新建飞书 docx → 移动到 DailyAI 节点
- 状态：已启用
