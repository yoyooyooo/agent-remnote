# Implementation Plan: WS 连接实例标识与活跃会话选举（移除 `consumerId`）

**Branch**: `003-ws-identity` | **Date**: 2026-01-24 | **Spec**: `specs/003-ws-identity/spec.md`  
**Input**: Feature specification from `specs/003-ws-identity/spec.md`

## Summary

把 WS 的“消费身份”从用户可共享配置（`consumerId`）迁移为可诊断、可路由的连接身份模型：

- **`connId`（server-assigned）**：服务端为每条连接分配的连接实例 id（UUID），用于路由、诊断、锁归属。
- **`clientInstanceId`（plugin-assigned, persisted）**：插件本地生成并持久化的实例 id（UUID），用于跨重连归因（无需用户配置）。
- **active worker 选举**：服务端基于 UI 活跃度（`uiContext/selection/lastSeen`）选举唯一 active worker；只有 active worker 能 `RequestOp` 消费队列与执行 read-rpc。

本变更为 forward-only：不做旧协议兼容层；协议/CLI/文档必须同步升级。

## Technical Context

**Language/Version**: TypeScript（ESM）+ Node.js 20+  
**Primary Dependencies**: `effect` / `@effect/cli` / `ws` / `better-sqlite3` / `zod`  
**Storage**: 队列 DB（`~/.agent-remnote/queue.sqlite`）+ WS state file（`~/.agent-remnote/ws.bridge.state.json`）  
**Testing**: `vitest`（主要在 `packages/agent-remnote`）+ `scripts/` 端到端模拟  
**Target Platform**: Node.js 20+（daemon/CLI）+ RemNote 桌面端插件运行时  
**Project Type**: bun workspace（`packages/*`）  
**Performance Goals**: active worker 选举/诊断查询必须是轻量常数开销（不影响写入派发）  
**Constraints**: 拒绝向后兼容；用户不应再被要求配置“消费 id”  
**Scale/Scope**: 单机本地多窗口/多端连接；默认唯一消费

补充事实：

- 现状使用 `consumerId` 的位置：
  - 协议/文档：`docs/ssot/agent-remnote/ws-bridge-protocol.md`、`docs/guides/ws-debug-and-testing.md`
  - bridge：`packages/agent-remnote/src/internal/ws-bridge/bridge.ts`（`activeOpRequesterByConsumerId` + `Register/RequestOp/TriggerStartSync/WhoAmI`）
  - plugin：`packages/plugin/src/bridge/runtime.ts`、`packages/plugin/src/bridge/settings.ts`
  - CLI：`packages/agent-remnote/src/commands/index.ts`、`packages/agent-remnote/src/services/Config.ts`、`packages/agent-remnote/src/services/WsClient.ts`、`packages/agent-remnote/src/commands/ws/sync.ts`
- 本 feature 是 Spec 005 的前置：read-rpc 的稳定路由依赖 `connId + active worker`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Forward-only evolution：删除 `consumerId` 属于 breaking change，但符合仓库策略；必须配套迁移说明与 docs/ssot 更新（PASS）。
- SSoT 优先：vNext 协议裁决必须落 `docs/ssot/agent-remnote/ws-bridge-protocol.md`；草案留 `docs/proposals/**`（PASS）。
- 唯一消费与可诊断身份：active worker/锁归属必须由 `connId` 表达，避免“用户配置背锅”（PASS）。
- 非破坏性默认：不触碰 `remnote.db`；队列锁字段仅改变语义不清库（PASS）。
- 用户可见输出英文：CLI 输出/错误信息必须英文（PASS，作为实现 gate）。
- Quality gates（实现前）：`npm run typecheck && npm run lint && npm run format:check && npm test`（PASS）。

## Project Structure

### Documentation (this feature)

```text
specs/003-ws-identity/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ws-protocol-vnext.md
│   └── cli.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/
├── core/
│   └── src/ws/bridge.ts
├── plugin/
│   ├── src/bridge/runtime.ts
│   └── src/bridge/settings.ts
└── agent-remnote/
    ├── src/commands/index.ts
    ├── src/commands/ws/sync.ts
    └── src/services/WsClient.ts

docs/
├── ssot/agent-remnote/ws-bridge-protocol.md
└── proposals/agent-remnote/ws-bridge-protocol-vnext.md
```

**Structure Decision**: 协议裁决以 `docs/ssot/agent-remnote/ws-bridge-protocol.md` 为准；本 feature 的契约与快速验证落在 `specs/003-ws-identity/`。

## Phase Plan（落地顺序）

### Phase A（协议定约：vNext）

- 定义 vNext 消息形状：去除 `consumerId`；新增 `connId`、`clientInstanceId`、`capabilities`/`clientType`（最小可行即可）。
- 定义 active worker 选举与 staleness：score 公式、阈值、迁移触发点（uiContext/selection 更新、连接 close）。

### Phase B（core/bridge：连接元数据 + 选举 + 路由）

- 在服务端为每条连接分配 `connId`，并写入 client meta/state file。
- 实现 active worker 选举与 `RequestOp` gating（非 active worker → `NoWork(reason='not_active_worker')`）。
- 将 `ops.locked_by` 从“consumerId 语义”切换为 `connId` 语义（字段不变；仅改变写入值与诊断口径）。
- `TriggerStartSync` 默认只触发 active worker；无 active worker 返回 `sent=0` + `nextActions[]`。

### Phase C（plugin：实例标识 + 注册上报）

- 生成并持久化 `clientInstanceId`（Local Storage）；注册时上报。
- 移除 consumerId 设置/生成逻辑；保持控制通道与 worker 通道行为一致（尽量复用 control WS 作为 worker）。

### Phase D（CLI：配置与诊断）

- 移除 `--consumer-id`/`REMNOTE_CONSUMER_ID`；改为按 state file 自动选择 active worker（可选增加 `--conn-id` 仅用于调试定向）。
- `ws sync`/`ws status`/`read connections` 输出增加 `connId/isActiveWorker/clientInstanceId` 与建议动作。

### Phase E（文档与 Skill）

- 更新 SSoT：`docs/ssot/agent-remnote/ws-bridge-protocol.md`（vNext：无 `consumerId` + active worker）。
- 更新排障与食谱：移除 consumerId 相关口径，新增 “active worker/connId”。
- 完善 `$remnote`：明确“最近会话唯一消费”的心智模型与 `nextActions`。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| active worker election | 保证多窗口/多端下唯一消费且可接管 | 继续用 `consumerId` 会把身份绑定到可共享配置，行为不确定且不可诊断 |
