# Data Model: agent-remnote 模块边界重组（core 合并后）

> 说明：此处的 “data-model” 指 **模块边界模型**（capability → module → dependency）。它是本次重组的“内部单一事实源”，用于指导实施与未来拆包。

**Feature**: `008-agent-module-reorg`  
**Date**: 2026-01-24  
**Goal**: 以不改变对外行为为前提，把现有能力在 `packages/agent-remnote` 内部一次性重组为清晰模块，并给出可抽包路线。

## 1) 分层（Layering）

```text
CLI Surface (contract)
  └─ packages/agent-remnote/src/main.ts
      └─ commands/**   (presentation: parse/compose/output)
          └─ services/** (Effect runtime adapters: config/errors/io)
              └─ internal/** (kernel modules: queue/ws-bridge/remdb-tools)
```

**强约束（依赖方向）**：

- `commands/**` 可以依赖 `services/**`（以及少量 `lib/**`），不得直接依赖 internal 的深层实现文件。
- `services/**` 可以依赖 `internal/**`，负责把 internal 的错误/返回值适配成 CLI 契约（尤其 `--json`）。
- `internal/**` **不得**依赖 `commands/**` / `services/**` / `@effect/cli`（避免 CLI 细节污染 kernel，保证未来可抽包）。

## 2) 模块清单（Modules）

### M0) CLI Contract（`main.ts` + `commands/**`）

**职责**：
- CLI 命令树与参数解析（`@effect/cli`）。
- 输出契约：`--json` envelope、stderr 纯度、exit code 语义。
- 用例编排：把 “读/写/daemon/队列/排障” 组合成子命令。

**关键入口**：
- `src/main.ts`
- `src/commands/index.ts`（root command）

**依赖**：
- `services/**`

### M1) Runtime Services（`services/**`）

**职责**：
- 统一配置解析与默认值（含 `~` 展开与 normalize）。
- IO/进程/WS client 的适配与生命周期。
- 将内部错误映射为稳定的 `CliError` / JSON envelope（保持对外契约）。

**关键模块**（现存）：
- `services/Config.ts`（配置权威入口）
- `services/Errors.ts` / `services/Output.ts`
- `services/WsClient.ts` / `services/Process.ts`
- `services/Queue.ts` / `services/RemDb.ts`
- `services/DaemonFiles.ts` / `services/SupervisorState.ts`

**依赖**：
- 可依赖 `internal/**` 与 `lib/**`（pure helper）。

### M2) Kernel: Queue（`internal/queue/**`）

**职责**：
- 队列 SQLite schema、打开 DB、迁移、DAO（enqueue/claim/ack/recover/stats）。
- 写入 payload sanitize（例如替换 “→”）。
- 不负责 CLI 输出与错误码；只抛出可诊断错误（由 services 映射）。

**对外最小入口（建议）**：`internal/queue/index.ts`

**核心 API（对齐现状）**：
- `openQueueDb(dbPath?: string): QueueDB`
- `enqueueTxn(db, ops, options?): txn_id`
- `getTxnIdByOpId(db, op_id): txn_id | null`
- `queueStats(db): { pending/in_flight/... }`
- `claimNextOp(db, lockedBy, leaseMs?): OpRow | null`
- `ackSuccess / ackRetry / ackDead`
- `recoverExpiredLeases`
- `upsertIdMap`

**依赖**：
- Node built-ins、`better-sqlite3`

**禁止依赖**：
- `effect` / `@effect/cli` / CLI 字符串与 env 透传。

### M3) Kernel: WS Bridge（`internal/ws-bridge/**`）

**职责**：
- WS 服务端：连接管理、注册/能力声明、active worker 选举。
- 队列派发：从 `internal/queue` claim op → dispatch → ack 回写。
- state file：写入 `ws.bridge.state.json` 快照；可选 tmux refresh；kick 策略。
- read-rpc 转发（SearchRequest/Response）。

**对外最小入口（建议）**：`internal/ws-bridge/index.ts`

**核心 API（对齐现状）**：
- `startWebSocketBridge(opts): StartedWsBridge | undefined`
- `ensureWebSocketBridge(opts): { bridge?: StartedWsBridge; restarted: boolean }`
- `getWsStatus(): { clients: ...; activeWorkerConnId?: string }`
- （可选）`notifyStartSync()` 供 CLI notify 调用

**依赖**：
- `internal/queue`
- `ws` + Node built-ins

**禁止依赖**：
- `@effect/cli` / `services/*` / CLI 文案拼接（除非保持现状临时存在；后续应迁到 services/presenters）。

### M4) Kernel: RemDB Tools（`internal/remdb-tools/**`）

**职责**：
- 对 `remnote.db` 的确定性只读查询：search/outline/inspect/todos/topic/daily 等。
- 解析/规范化 RemNote 的 quanta doc 结构；提供结构化结果（可含 markdown，但应集中在工具层而非 CLI）。
- hard-timeout（worker 线程）策略保持不变。

**对外最小入口（建议）**：`internal/remdb-tools/index.ts`

**核心 API（对齐现状）**：
- `executeSearchRemOverview`
- `executeSearchQuery`
- `executeOutlineRemSubtree`
- `executeInspectRemDoc`
- `executeResolveRemReference`
- `executeResolveRemPage`
- `executeFindRemsByReference`
- `executeGetRemConnections`
- `executeReadRemTable`
- `executeListRemBackups`
- `executeListRemReferences`
- `executeListTodos`
- `executeSummarizeDailyNotes`
- `executeSummarizeTopicActivity`
- `TYPES`（supported ops catalog）

**依赖**：
- `better-sqlite3` / `zod` / `ws`（仅当工具需要 ws 类型，否则应移除）/ `date-fns` / `unified` + `remark-*`

**禁止依赖**：
- CLI/Effect；不得写 stdout/stderr；不得写入 `remnote.db`。

### M5) Shared Helpers（`lib/**`）

**职责**：
- 轻量、纯函数 helper（路径展开、ws state 文件读取、RemNote deep link 解析等）。
- 可以被 `commands/services` 使用；internal 若需要共享能力，应通过“无副作用的纯函数”依赖，避免反向耦合。

## 3) 能力归属（Capability → Module）

| Capability | Current implementation | Target module |
|-----------|------------------------|--------------|
| Queue DB open/schema/migrate | `packages/core/src/queue/*` | `internal/queue/*` |
| WS bridge daemon | `packages/core/src/ws/bridge.ts` | `internal/ws-bridge/bridge.ts` |
| Read-only DB tools | `packages/core/src/tools/*` | `internal/remdb-tools/*` |
| CLI config/output/error envelope | `packages/agent-remnote/src/services/*` | `services/*`（保留） |
| CLI commands | `packages/agent-remnote/src/commands/*` | `commands/*`（保留） |

## 4) 迁移映射（文件路径级）

> 目标：让实施阶段可以按“无损搬迁”逐文件迁移，最后删除 `packages/core`。

**From `packages/core/src/queue/**` → `packages/agent-remnote/src/internal/queue/**`**：
- `queue/db.ts` → `internal/queue/db.ts`
- `queue/dao.ts` → `internal/queue/dao.ts`
- `queue/sanitize.ts` → `internal/queue/sanitize.ts`
- `queue/schema.sql` → `internal/queue/schema.sql`

**From `packages/core/src/ws/**` → `packages/agent-remnote/src/internal/ws-bridge/**`**：
- `ws/bridge.ts` → `internal/ws-bridge/bridge.ts`

**From `packages/core/src/tools/**` → `packages/agent-remnote/src/internal/remdb-tools/**`**：
- `tools/shared.ts` → `internal/remdb-tools/shared.ts`
- `tools/searchRemOverview.ts` → `internal/remdb-tools/searchRemOverview.ts`
- `tools/executeSearchQuery.ts` → `internal/remdb-tools/executeSearchQuery.ts`
- `tools/outlineRemSubtree.ts` → `internal/remdb-tools/outlineRemSubtree.ts`
- `tools/inspectRemDoc.ts` → `internal/remdb-tools/inspectRemDoc.ts`
- `tools/resolveRemReference.ts` → `internal/remdb-tools/resolveRemReference.ts`
- `tools/resolveRemPage.ts` → `internal/remdb-tools/resolveRemPage.ts`
- `tools/findRemsByReference.ts` → `internal/remdb-tools/findRemsByReference.ts`
- `tools/getRemConnections.ts` → `internal/remdb-tools/getRemConnections.ts`
- `tools/readRemTable.ts` → `internal/remdb-tools/readRemTable.ts`
- `tools/listRemBackups.ts` → `internal/remdb-tools/listRemBackups.ts`
- `tools/listRemReferences.ts` → `internal/remdb-tools/listRemReferences.ts`
- `tools/listTodos.ts` → `internal/remdb-tools/listTodos.ts`
- `tools/summarizeDailyNotes.ts` → `internal/remdb-tools/summarizeDailyNotes.ts`
- `tools/summarizeTopicActivity.ts` → `internal/remdb-tools/summarizeTopicActivity.ts`
- `tools/listSupportedOps.ts` → `internal/remdb-tools/listSupportedOps.ts`
- 其余 `tools/*`（search utils/query types/time filters/markdown prepare）按同结构迁移。

**Public surface（用于替换原 `public.ts`）**：
- 原 `packages/core/src/public.ts` 的导出集合，迁移为 `packages/agent-remnote/src/internal/index.ts`（或 `internal/public.ts`）作为 internal 的统一门面。

### Legacy adapter surface（必须保持不变）

> 当前 `packages/agent-remnote/src/adapters/core.ts` 作为“core 门面”对上层服务/命令提供的导出集合。实施阶段应确保 internal 门面至少覆盖以下符号，以避免大面积改调用方：

- Types: `BackupInfo`, `BetterSqliteInstance`, `DbResolution`
- Values/Functions:
  - `TYPES`
  - `discoverBackups`, `withResolvedDatabase`
  - `getDateFormatting`, `formatDateWithPattern`
  - `openQueueDb`, `enqueueTxn`, `getTxnIdByOpId`, `queueStats`
  - `startWebSocketBridge`
  - `executeSearchRemOverview`, `executeSearchQuery`
  - `executeOutlineRemSubtree`, `executeInspectRemDoc`
  - `executeResolveRemReference`, `executeResolveRemPage`, `executeFindRemsByReference`
  - `executeGetRemConnections`, `executeReadRemTable`
  - `executeListRemBackups`, `executeListRemReferences`, `executeListTodos`
  - `executeSummarizeDailyNotes`, `executeSummarizeTopicActivity`

## 5) 未来拆包（Package candidates）

> 仅做规划，不在本次重组直接实施。

候选硬子包（从 internal 迁出）：

1. `@agent-remnote/queue`：纯队列 DB 与调度语义（无 CLI/Effect）。
2. `@agent-remnote/ws-bridge`：daemon（依赖 queue），对插件/CLI 提供 WS 协议服务。
3. `@agent-remnote/remdb-tools`：只读 DB 工具（search/outline/query/todos/topic/daily）。

触发条件与迁移步骤见：`specs/008-agent-module-reorg/contracts/future-packaging.md`。
