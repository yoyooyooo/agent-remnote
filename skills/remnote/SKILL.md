---
name: remnote
description: "Use when interacting with RemNote: querying local notes, reading current page/focus/selection, using host API remote mode from containers, writing to DN/当前页面/当前块, importing Markdown bullet trees, creating deterministic references, or diagnosing queue/WS/plugin sync."
---

# RemNote

## 默认优先级（最重要）

- **默认写入格式**：优先使用 **Markdown + 无序列表 + 缩进层级**。
- **默认写入命令**：优先 `agent-remnote import markdown --stdin`，不要先落本地临时文件。
- **默认执行模式**：优先“异步入队”路径；已知 `parent/ref` 的写入默认不要加 `--wait`。
- **默认内容策略**：先把内容整理成结构化列表，再写入 RemNote；不要把聊天原文、原始 Markdown 标题层级、过程噪音直接落库。
- **默认验证动作**：仅在用户明确要求、目标 parent 不确定、需要新节点 ID、或上次返回 `sent=0/failed/timeout` 时再做 `rem outline` 或 `search` 验证。
- **强警告**：`daily write --text` 仅适合**短纯文本**；凡是有层级、标题、列表、引用、研究总结、DN 沉淀，一律优先 `import markdown`。

## 核心约束（先遵守）

- 禁止直接写入 RemNote 官方数据库 `remnote.db`（只读允许）。
- 写入必须走队列：入队 →（可选）WS 触发同步 → 插件用 `@remnote/plugin-sdk` 执行 → 回写结果到队列库。
- 创建类写入禁止“无 parent”：所有创建 Rem 的操作必须提供 `parentId/parent_id`。
- 现有安全链路**不应承诺**“直接创建 `parent=null` 的顶层全局页”；若 CLI 未显式支持，就视为不可安全自动化。

## 这次新增能力（推荐直接用）

### 1）Host API / 远端模式（容器 / 远端 Agent）

如果 Agent 不在宿主机里，而是在容器或其他环境中运行，不要直接挂载 `remnote.db` / `store.sqlite`。

优先用：

```bash
agent-remnote stack ensure
agent-remnote api status --json
```

业务命令可直接切到 remote mode：

```bash
agent-remnote --api-base-url http://host.docker.internal:3000 search --query "keyword"
REMNOTE_API_BASE_URL=http://host.docker.internal:3000 agent-remnote plugin current --compact
```

裁决：

- `api` 命令组只负责 API 生命周期
- 业务命令仍保留原命令名
- 优先级：`--api-base-url` > `REMNOTE_API_BASE_URL`

### 2）最推荐的“当前上下文”读取命令

如果你只是想知道“我现在到底在哪 / 选中了什么 / 最应该写到哪里”，优先级如下：

1. `agent-remnote --json plugin current --compact`
2. `agent-remnote --json plugin selection current --compact`
3. `agent-remnote --json plugin ui-context describe`
4. `agent-remnote --json plugin selection outline --max-depth 2 --max-nodes 50`

推荐原因：

- `plugin current --compact`：一次返回 page / focus / current / selection 的极简聚合结果，最适合 Agent 决策。
- `plugin selection current --compact`：只关心“当前选中的 Rem”时最简。
- `ui-context describe`：适合需要解释当前页面/portal/anchor/focus 时使用。
- `selection outline`：适合真的要读选区内容树时使用。

### 3）active worker 等待门槛

如果你刚重启了 `daemon + api`，不要默认认为插件已经立刻 ready。

优先用：

```bash
agent-remnote stack ensure --wait-worker --worker-timeout-ms 15000
```

适用：

- 刚重启完进程就要读 selection / uiContext
- 刚切回 RemNote，希望确认 active worker 已恢复
- 容器侧 Agent 需要一个更稳的“准备就绪”门槛

不适用：

- 已经拿到明确 `parentId/ref`，只是做一次普通追加写入
- 用户没有要求“同一轮确认消费成功”

## 什么时候用什么命令（决策表）

### 1）研究结论 / DN / 页面沉淀 / 分层笔记

默认用：

```bash
cat <<'MD' | agent-remnote --json import markdown --parent <parentRemId> --stdin --bulk never
- 主题
  - 结论 1
  - 结论 2
MD
```

适用：

- 调研总结
- 复盘
- 会议纪要整理后写入
- 每日笔记（DN）
- 需要层级结构的任何内容

### 2）短纯文本追加

仅当内容确实是**一小段纯文本**时才考虑：

```bash
agent-remnote --json daily write --text "..."
agent-remnote --json rem create --parent "<parentRemId>" --text "..."
```

不适用：

- 带列表/标题/多层级内容
- 要求生成引用
- 要求保留结构

### 3）改已有 Rem 文本

```bash
agent-remnote --json rem set-text --rem "<remId>" --text "..." --wait
```

### 4）语义操作（不要硬塞 Markdown）

- Portal：`portal create`
- Tag：`tag add/remove`
- Table：`table *`
- 移动：`rem move`
- 删除：`rem delete`

## 目标定位（写到哪）

### 当前页面 / 当前块 / 选区

- **当前页面**：取 `PRID = uiContext.pageRemId`
- **当前块**：取 `FRID = uiContext.focusedRemId`
- **当前选区**：取 `SEL.remIds`

常用命令：

```bash
agent-remnote --json plugin current --compact
agent-remnote --json plugin selection current --compact
agent-remnote --json plugin ui-context snapshot
agent-remnote --ids  plugin ui-context page
agent-remnote --ids  plugin ui-context focused-rem
agent-remnote --json plugin selection snapshot
agent-remnote --ids  plugin selection roots
```

### DN（每日笔记）特别规则

这是最容易写错的地方：

- **必须区分** `Daily Document` 容器页 和 当天那条 `YYYY/MM/DD` 子 Rem。
- 不要默认把 `daily:today` / `pageRemId` / `Daily Document` 容器当成最终写入 parent。
- 如果用户说的是“写到今天这条日记下面”，优先把 **当天日期那条 Rem** 找出来，再写到它下面。

推荐 SOP：

1. 先确认当前是不是 Daily Document 容器页。
2. 如果是容器页，再解析当天日期子 Rem。
3. 把结构化 Markdown 写到**当天日期 Rem**下面，而不是容器根下。

可用命令：

```bash
agent-remnote --ids rem page-id --ref daily:today
agent-remnote rem outline --ref daily:today --depth 2 --format md
agent-remnote --json search --query "2026/03/08" --limit 20
```

## 引用 / Portal / 页面链接（必须区分）

### 最稳的引用写法

在 `import markdown` 里，优先使用显式 ID 引用：

- `((RID))`
- `{ref:RID}`

这两种写法都比标题猜测更稳。

### 不推荐默认依赖标题引用

- `[[Title]]` / 类 wiki-link 标题引用，只有在**歧义可接受**时才使用。
- 需要可重复、可验证、可脚本化时，优先 `((RID))` / `{ref:RID}`。

### Portal 不是 Reference

- `((RID))` / `{ref:RID}` 是双链引用。
- Portal 是 `RemType.PORTAL=6` 的容器 Rem。
- 要插 Portal，优先 `agent-remnote portal create`，不要拿引用语法冒充。

## 写入 SOP（默认执行流程）

1. **按需健康检查**：仅在首次接入、环境刚切换、刚重启服务、或前一次返回 `sent=0/failed/timeout` 时执行 `agent-remnote --json doctor`
2. **解析目标 parent**：`PRID` / `FRID` / `SEL` / 当天日期 Rem
3. **先整理内容**：转成 Markdown 无序列表；默认不要用 `#`/`##` 标题作为最终落库结构
4. **写入**：优先 `import markdown --stdin --bulk never`，默认不加 `--wait`
5. **必要时加引用**：标题和关键概念优先 `((RID))`
6. **按需验证**：仅在用户明确要求验收、目标定位风险高、需要新节点 ID、或返回异常状态时再跑 `queue wait / rem outline / search`

## 默认快速路径（低 token）

适用：

- 用户给了明确页面 / `parentId` / `ref`
- 目标是“追加一段结构化内容”
- 这轮不要求同步确认已消费

推荐流程：

1. 直接整理成无序列表 Markdown
2. 直接执行 `import markdown --stdin --bulk never`
3. 只读取返回里的 `txn_id`、`op_ids`、`sent`
4. 若 `sent > 0`，本轮即可结束
5. 若 `sent = 0`，再进入诊断分支：`daemon status` → 必要时切回 RemNote → `daemon sync` / `queue wait`

推荐命令：

```bash
cat <<'MD' | agent-remnote --json import markdown --parent <parentRemId> --stdin --bulk never
- 标题
  - 子项
MD
```

只有在用户明确要求“写完马上确认结果”时，才补以下任一动作：

- 同一次调用加 `--wait --timeout-ms 60000`
- 或二段式执行 `agent-remnote --json queue wait --txn <txn_id>`

默认命令模板：

```bash
cat <<'MD' | agent-remnote --json import markdown --parent <parentRemId> --stdin --bulk never
- 主题
  - 关键结论
  - 关键证据
  - 待验证
MD
```

## 写入前格式约束（防踩坑）

- 优先无序列表 `-` + 缩进。
- 默认不要把聊天中的 `##` / `###` 原样写入 RemNote。
- 默认不要用空行分隔段落；空行可能变成空 Rem。
- 如果必须保留代码块，可保留 fenced code block，但其外部仍应尽量无空行。
- 如果是知识卡片 / 决策卡 / DN 研究沉淀，优先把“章节”改写成父级列表项，而不是 Markdown 标题。

## 写入后按需验收

仅在以下场景执行验收：

- 用户明确要求“确认已写入”
- 目标 parent 来自 `current/focus/selection`，定位风险高
- DN 场景，需要确认写到当天条目下
- 返回出现 `sent=0`、`TXN_TIMEOUT`、`TXN_FAILED`
- 需要拿到新创建 Rem 的 ID 继续后续操作

常用验收动作：

```bash
agent-remnote --json queue wait --txn "<txn_id>"
agent-remnote rem outline --id "<targetParentOrCreatedRemId>" --depth 3 --format md
agent-remnote --json search --query "<标题关键词>" --limit 10
agent-remnote --json rem inspect --id "<remId>"
```

验收重点：

- 有没有把原始 Markdown 标题符号当纯文本写进去？
- 有没有写到错误 parent（尤其是 DN 容器根）？
- 引用是不是变成了真正的 `{ref:...}` / Reference，而不是纯文本？
- 列表层级有没有坍塌成一整行？

## 机器执行 / JSON 使用注意事项

- `--json` 结果应优先作为机器消费输出。
- 若 Agent 不在宿主机：优先加 `--api-base-url http://host.docker.internal:3000`（或设置 `REMNOTE_API_BASE_URL`）。
- 需要“最薄决策输入”时，优先 `plugin current --compact`，其次 `plugin selection current --compact`。
- 若外层 shim / wrapper 混入 banner/help，脚本消费时应取最后一条 JSON，或直接切换到更纯净的 CLI 入口。
- 在这套个人环境里，如果 `agent-remnote` 命中 dev shim 并报模块缺失，可优先尝试：

```bash
AGENT_REMNOTE_MODE=prod agent-remnote --json doctor
node <remnote-mcp>/packages/agent-remnote/cli.js --json doctor
```

## 高频失败场景与处理

### 1）`daily write --text` 把 Markdown 当纯文本写进去

处理：

- 删除错误条目
- 改用 `import markdown --stdin`
- 内容改成无序列表结构后重写

### 2）内容写到了 `Daily Document` 根下，而不是当天条目下

处理：

- 先找到当天 `YYYY/MM/DD` 那条 Rem
- 把内容移动/重写到当天条目下面
- 不要再把容器页当最终 parent

### 3）标题关键词想变成“全局页面引用”，结果自动创建到了错误 parent

处理：

- 只对**已存在页面**使用 `((RID))`
- 缺失页面且没有明确全局 parent 时，不要静默创建到 DN/当前页下
- 如确需创建概念页，先确定概念页应该挂到哪

### 4）`sent=0`

- 表示入队成功，但没有 active worker 立即消费
- 先切到 RemNote 窗口触发一次 UI 事件，再重试
- 诊断：`agent-remnote --json daemon status`

## 常用命令（保留最常用的一组）

### 健康检查

```bash
agent-remnote --json doctor
agent-remnote --json queue stats
agent-remnote --json daemon status
```

### 读取 UI 上下文

```bash
agent-remnote --json plugin current --compact
agent-remnote --json plugin selection current --compact
agent-remnote --json plugin ui-context snapshot
agent-remnote --ids  plugin ui-context page
agent-remnote --ids  plugin ui-context focused-rem
agent-remnote --json plugin selection snapshot
agent-remnote --ids  plugin selection roots
```

### 结构化写入（默认）

```bash
cat <<'MD' | agent-remnote --json import markdown --parent <parentRemId> --stdin --bulk never
- 标题
  - 子项
MD
```

### 结构化写入并等待结果（仅按需）

```bash
cat <<'MD' | agent-remnote --json import markdown --parent <parentRemId> --stdin --bulk never --wait --timeout-ms 60000
- 标题
  - 子项
MD
```

### 单条文本写入

```bash
agent-remnote --json rem create --parent "<parentRemId>" --text "..." --wait
agent-remnote --json daily write --text "..."
```

### 精确操作

```bash
agent-remnote --json rem set-text --rem "<remId>" --text "..." --wait
agent-remnote --json rem move --rem "<remId>" --parent "<newParentRemId>" --wait
agent-remnote --json rem delete --rem "<remId>" --wait
agent-remnote --json portal create --parent "<parentRemId>" --target "<targetRemId>" --wait
```

### 校验

```bash
agent-remnote rem outline --id "<remId>" --depth 4 --format md
agent-remnote --json search --query "<keyword>" --limit 10
agent-remnote --json rem inspect --id "<remId>"
```

## 缩写（仅保留最常用）

- `DN`：Daily Note / Daily Notes
- `RID`：Rem ID
- `PRID`：`uiContext.pageRemId`
- `FRID`：`uiContext.focusedRemId`
- `SEL`：当前选区
- `UIC`：UI Context
- `QDB`：队列库
- `RNDB`：RemNote 本地只读库
- `TXN`：事务 ID

## 更多概念

- 详细概念与字段说明：`references/remnote-concepts.md`

## 环境变量（可选）

```bash
export REMNOTE_DB="$HOME/remnote/remnote-xxx/remnote.db"
export REMNOTE_QUEUE_DB="$HOME/.agent-remnote/queue.sqlite"
export REMNOTE_DAEMON_URL="ws://localhost:6789/ws"
export REMNOTE_WS_STATE_FILE="$HOME/.agent-remnote/ws.bridge.state.json"
export REMNOTE_WS_STATE_STALE_MS="60000"
```
