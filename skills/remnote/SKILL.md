---
name: remnote
description: 'Use this skill for anything the user wants to do inside RemNote or through `agent-remnote`: write or reorganize Daily Notes and Rem trees, edit by `remId`, inspect the current page/focus/selection, troubleshoot queue/plugin/daemon issues like `sent=0`, work in remote `apiBaseUrl` mode, or figure out the right RemNote command, `scenario` var, or dry-run path. Trigger even if they only mention Daily Note, 今日笔记, `remId`, `apiBaseUrl`, `plugin current`, `queue wait`, or a `scenario` id. Do not use it for Notion, Obsidian, tmux, GitHub, generic SQLite edits, or generic Markdown/file work outside RemNote.'
---

# RemNote

## Core Goal

用最短路径完成 RemNote 读写。

优先级固定如下：

1. 能一步完成的业务命令，直接一步完成
2. 默认只发起写入，不等待消费完成
3. 默认不做额外读取、不做事前 inspect、不做写后验证
4. 只有多步依赖或用户明确要求时，才进入 `apply`、`queue wait`、`rem outline`

命令面分层固定如下：

1. Agent-primary
   `apply`、`rem ...`、`daily write`、`tag ...`、`portal ...`、`backup ...`
2. Structured-data primary write surface
   `table ...`
3. Advanced/local-only
   `replace markdown`
4. Auxiliary reads
   `daily rem-id`、`plugin current --compact`、`powerup list/resolve/schema`、`table show`
5. Ops / lifecycle
   `daemon ...`、`api ...`、`stack ...`、`queue ...`、`doctor`、`config ...`

## Hard Rules

- 禁止直接写入 RemNote 官方数据库 `remnote.db`
- 所有写入必须走 `queue -> WS -> plugin SDK`
- 默认不要加 `--wait`
- 默认不要在写入前先 `inspect`、`search`、`outline`
- 用户给了明确 `remId` / `parentRemId` 时，直接写
- `powerup` 的读命令可以直接用，写命令不要作为默认 Agent 主路径
- 结构化数据写入默认走 `table ...`
- 固定 URL / 固定端口问题优先走 `config print`、`stack status`、`doctor --fix`、`stack takeover`
- source worktree 默认是 isolated `dev` profile；不要把它当作 canonical `stable` owner

## Progressive Disclosure

主 `SKILL.md` 只负责入口路由。

按任务类型按需加载下面的 reference，不要一次性把所有细则都搬进回答。

### 1. 概念模型

读 [remnote-concepts.md](references/remnote-concepts.md)：

- 需要区分 Rem / Page / Daily Note / Portal / Selection
- 需要理解 UI 上下文、双链、富文本与 Markdown 的关系

### 2. 写入命令选择

读 [write-routes.md](references/write-routes.md)：

- 需要在 `rem children append|prepend|replace|clear`、`daily write`、`rem create`、`rem move`、`tag`、`apply` 之间选命令
- 需要处理 promotion 路由、短纯文本新增、多步依赖写入
- 需要处理 table / property 边界

### 3. 内容结构与 Daily Note 形状

读 [content-shape.md](references/content-shape.md)：

- 需要判断内容是否适合大纲
- 需要决定单根 / 多根、bundle / 非 bundle
- 需要写 Daily Note、扩写现有 Rem、处理 DN parent
- 需要处理引用和 portal 的结构语义

### 4. 运行时、远端与失败排障

读 [runtime-ops.md](references/runtime-ops.md)：

- 需要决定是否 `--wait`
- 需要处理 `sent=0`、`TXN_TIMEOUT`、错误 parent、typed property 边界
- 需要在 `apiBaseUrl` 模式下判断 remote vs host-only
- 需要选择读路径、help-first、plugin/daemon/queue 排障
- 需要判断当前是 `stable` 还是 isolated `dev` profile
- 需要处理 canonical fixed-owner claim、`stack takeover --channel dev|stable`
- 需要处理 direct `daemon/api/plugin start|ensure` 被 claim guard 拒绝的情况

### 5. Scenario Surface

读 [scenario-surface.md](references/scenario-surface.md)：

- 用户提到 `scenario schema *`
- 用户提到 `scenario builtin *`
- 用户提到 `scenario run`
- 用户提到 builtin scenario id
- 用户提到 `~/.agent-remnote/scenarios`
- 用户问 `source_scope`、`target_ref`、`daily:last-*`、`daily:past-*`

reference 里会继续给出这些入口的明确示例：

- `scenario schema validate`
- `scenario schema normalize`
- `scenario schema explain`
- `scenario schema generate`
- `scenario builtin install`

## Help-First Exceptions

默认不要为了普通高频命令先跑 `--help`。

但遇到下面几类面时，先看 help 再组命令：

- `scenario` 这种 planned / experimental surface
- 低频命令族，且你这轮要传多个 flags
- var type 是 `scope` / `ref` 这类泛型字符串，但当前 prompt 又依赖精确字面量

## Scenario Router

`scenario` 仍然是 planned / experimental surface。

处理顺序：

1. help-first
2. 读 `scenario-surface.md`
3. 先 explain / list，再 dry-run
4. 只有确认 lowering 符合预期，才真正写入

`scenario run` 当前只属于 planned / experimental namespace，不要把它当 current public stable surface 对外承诺。

## Remote / Parity Authority

涉及 remote parity、host-only、same-support 分类时，以 `docs/ssot/agent-remnote/runtime-mode-and-command-parity.md` 为唯一权威源。

本 skill 只负责路由，不单独定义命令分类。

## Principle

- 只要用户意图能被一个业务命令直接表达，就不要升级到两步
- 只要用户没有要求同步确认，就不要主动 wait
- 只要目标 rem 已知，就不要先查再写
