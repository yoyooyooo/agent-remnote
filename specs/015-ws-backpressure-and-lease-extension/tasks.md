# Tasks: WS Backpressure + Lease Strategy/Extension (015)

**Input**: `specs/015-ws-backpressure-and-lease-extension/`  
**Prerequisites**: `spec.md`, `data-model.md`, `plan.md`

## Phase 0: Spec & Wiring

- [x] T000 创建 015 规格骨架：`specs/015-ws-backpressure-and-lease-extension/**`
- [x] T001 在 `specs/README.md` 补齐路线索引：`specs/README.md`

## Phase 1: Protocol & SSoT（反哺）

- [x] T010 SSoT：为 `RequestOps` 增加 `maxBytes/maxOpBytes` 并固化 clamp/诊断字段：`docs/ssot/agent-remnote/ws-bridge-protocol.md`
- [x] T011 SSoT：为 `OpDispatchBatch` 增加 `budget`/`skipped` 诊断字段：`docs/ssot/agent-remnote/ws-bridge-protocol.md`
- [x] T012 SSoT：固化 lease 策略与（可选）续租语义：`docs/ssot/agent-remnote/queue-schema.md` + `docs/ssot/agent-remnote/ws-bridge-protocol.md`
- [x] T013 SSoT：新增 oversize 的稳定错误码与 nextActions 指引（英文）：`docs/ssot/agent-remnote/ws-bridge-protocol.md`（以及必要时 `docs/ssot/agent-remnote/cli-contract.md`）

## Phase 2: Daemon budget enforcement

- [x] T020 WS runtime：解析 `RequestOps.maxBytes/maxOpBytes` + clamp（server-side 强制）：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- [x] T021 WS runtime：实现 budget 装箱（保证 `OpDispatchBatch` 不超预算；返回 skipped 统计）：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- [x] T022 WS runtime：单 op oversize 收敛（稳定错误码 + nextActions；避免无限抖动）：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` + `packages/agent-remnote/src/internal/queue/dao.ts`
- [x] T023 Config：引入默认预算配置（env/cli）并接入 `ResolvedConfig`：`packages/agent-remnote/src/services/Config.ts` + tests

## Phase 3: Lease policy & LeaseExtend

- [x] T030 Queue DAO：实现 `extendLease(opId, attemptId, connId, extendMs)`（CAS 命中才更新 `lease_expires_at`）：`packages/agent-remnote/src/internal/queue/dao.ts`
- [x] T031 WS runtime：处理 `LeaseExtend` 消息并返回可诊断响应（ok/rejected + reason）：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- [x] T032 Plugin：为长 op 增加续租（执行中定期发送 extend；停止条件：AckOk/失败/被拒绝）：`packages/plugin/src/bridge/runtime.ts`
- [x] T033 Plugin：在 `RequestOps` 中发送 `maxBytes/maxOpBytes`（与并发槽位匹配）：`packages/plugin/src/bridge/runtime.ts`

## Phase 4: Tests

- [x] T040 Contract：budget 不超 + skipped 统计 shape：`packages/agent-remnote/tests/contract/**`
- [x] T041 Integration-ish：长 op + 续租覆盖 + stale extend 被拒绝：`packages/agent-remnote/tests/integration/**`
- [x] T042 Contract：oversize op 的稳定错误码/nextActions：`packages/agent-remnote/tests/contract/**`

## Phase 5: Doc sync（实现落地后）

- [x] T050 更新调试指南：如何观测 budget/lease/extend：`docs/guides/ws-debug-and-testing.md`
