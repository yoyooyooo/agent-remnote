# Research 003：WS 连接实例标识与活跃会话选举（移除 `consumerId`）

**Feature**: `specs/003-ws-identity/spec.md`  
**Date**: 2026-01-24

## 关键事实（来自代码/文档）

- 现有 SSoT 协议以 `consumerId` 作为“消费组”与路由依据：`docs/ssot/agent-remnote/ws-bridge-protocol.md`。
- bridge 侧通过 `activeOpRequesterByConsumerId` 实现“同 consumerId 仅一个 worker 拉取 op”：`packages/agent-remnote/src/internal/ws-bridge/bridge.ts`。
- 插件侧 `consumerId` 来自 Local Storage 自动生成：`packages/plugin/src/bridge/settings.ts`（`agent-remnote.consumer-id`），并在 `runtime.ts` 用于 `Register/RequestOp`。
- CLI 侧把 `consumerId` 暴露为根级 option，并透传到 `ws sync` 等命令：`packages/agent-remnote/src/commands/index.ts`、`packages/agent-remnote/src/commands/ws/sync.ts`、`packages/agent-remnote/src/services/WsClient.ts`。
- 当前 bridge state file（`~/.agent-remnote/ws.bridge.state.json`）记录 `clients[]`，字段包含 `connId/clientInstanceId/connectedAt/lastSeenAt/selection/uiContext`：`packages/agent-remnote/src/internal/ws-bridge/bridge.ts`。

## Decision Log

### D1：彻底移除 `consumerId`（协议/配置/日志/脚本）

- **Decision**：不再把 `consumerId` 作为任何行为的关键参数；不让用户配置“消费 id”。协议与 CLI 一并迁移（forward-only）。
- **Rationale**：`consumerId` 来自可共享/可忽略配置，无法稳定表达“连接实例是谁”或“哪个会话最近活跃”，多窗口/多端下会误导排障与路由。
- **Alternatives considered**：
  - 继续保留 `consumerId` 但默认自动生成：依然会把身份和“可共享配置”绑定，且仍需要用户理解它。

### D2：`connId` 由服务端分配（每条连接唯一，断线重连会变）

- **Decision**：服务端在 `connection` 时生成 `connId`（UUID），并在 `HelloAck/Registered/Clients/YouAre` 等诊断消息中可见。
- **Rationale**：服务端最了解“连接实例”；用不可预测 UUID 能避免碰撞与伪造（在 localhost 信任边界内仍有价值）。
- **Alternatives considered**：
  - 由插件生成：无法代表“连接实例”，重连/多连接下容易歧义。

### D3：`clientInstanceId` 由插件生成并本机持久化（跨重连稳定）

- **Decision**：插件生成 `clientInstanceId` 并写入 Local Storage（替代 `agent-remnote.consumer-id`），注册时上报。
- **Rationale**：便于跨重连归因与诊断（“同一个插件实例”），又不要求用户配置。
- **实现建议**：优先使用 `crypto.randomUUID()`；无该 API 时降级到“时间戳 + 随机”方案（不要求可复现）。

### D4：active worker 选举以“UI 活跃度”驱动

- **Decision**：服务端维护 active worker，候选集合=声明 `capabilities.worker=true` 的连接；score 取：
  - `activityAt = max(uiContext.updatedAt, selection.updatedAt)`（缺失按 0；`lastSeenAt` 仅用于 stale 过滤）
  - 选择 `activityAt` 最大且未 stale 的连接作为 active worker
- **Rationale**：用户在 RemNote 里“最近操作的窗口”才应该消费队列；UI 活跃度是最可信信号。
- **Alternatives considered**：
  - 固定一个连接直到手动切换：会让“卡死/断线接管”变复杂，且对用户不友好。

### D5：`RequestOp` gating 语义从 `worker_busy` 演进为 `not_active_worker`

- **Decision**：非 active worker 调用 `RequestOp` 时返回 `NoWork(reason='not_active_worker', activeConnId)`；active worker 才能拉取 op/执行 read-rpc。
- **Rationale**：把“唯一消费”的原因表达清楚，便于诊断与引导用户切换到目标窗口。

### D6：`TriggerStartSync` 默认只触发 active worker

- **Decision**：CLI/生产者不再指定 consumerId；默认触发 active worker。若无 active worker，返回 `sent=0` + `nextActions[]`。
- **Rationale**：避免用户/Agent 需要理解定向 id；同时把“为什么没触发”说清楚。

## 风险与缓解

- **风险：插件打开多个 WS 连接（control/worker）导致选举混乱** → **缓解**：只把具备 `worker=true` 的连接纳入候选，并鼓励插件复用 control 连接作为 worker（减少连接数）。
- **风险：active worker 卡死但连接仍存活** → **缓解**：引入 staleness 阈值与 TTL；超过阈值自动接管到下一候选。
- **风险：迁移 breaking change 影响调试脚本** → **缓解**：同步更新 `docs/guides/ws-debug-and-testing.md` 与 `scripts/ws-*.ts`，以 `connId/activeWorker` 为口径。
