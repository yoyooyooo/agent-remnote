# Acceptance Report: 003-ws-identity（上帝视角验收）

**Date**: 2026-01-26  
**Spec**: `specs/003-ws-identity/spec.md`  
**Scope**: 覆盖 `spec.md` 内所有编码点：SC / FR / NFR  

## 总结裁决

- **整体结论**：通过（PASS）。`consumerId` 已从协议与实现口径中移除；服务端 `connId` 作为连接实例标识与锁归属；active worker 基于 UI 活跃度选举并唯一允许消费队列；read-rpc 具备 requestId 关联与路由隔离基础能力。

## 证据索引（高信号）

- WS 协议 SSoT：`docs/ssot/agent-remnote/ws-bridge-protocol.md`
- 003 契约（CLI/协议 vNext）：`specs/003-ws-identity/contracts/{cli.md,ws-protocol-vnext.md}`
- WS bridge runtime（connId/选举/路由）：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`
- Queue lock 归属（locked_by=connId）：`packages/agent-remnote/src/internal/queue/dao.ts`
- Integration-ish：握手/路由/state file：`packages/agent-remnote/tests/integration/ws-bridge-runtime.integration.test.ts`

## 覆盖矩阵（SC/FR/NFR）

| Code | 结论 | 证据（实现/测试/文档） | 漂移/缺口 |
|---|---|---|---|
| SC-001 | PASS | active worker gating：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`（与 v2 batch pull/013 attempt_id 一致） | 无 |
| SC-002 | PASS | stale/接管语义：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` | 无 |
| SC-003 | PASS | read-rpc requestId 关联与路由：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`、`packages/agent-remnote/tests/integration/ws-bridge-runtime.integration.test.ts` | 无 |
| FR-001 | PASS | 协议不再出现 consumerId：`docs/ssot/agent-remnote/ws-bridge-protocol.md`（并与 003 vNext 契约一致） | 无 |
| FR-002 | PASS | connId 分配与握手：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`、`docs/ssot/agent-remnote/ws-bridge-protocol.md` | 无 |
| FR-003 | PASS | clientInstanceId 上报：`packages/plugin/src/bridge/runtime.ts`、`docs/ssot/agent-remnote/ws-bridge-protocol.md` | 无 |
| FR-004 | PASS | active worker 选举：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` | 无 |
| FR-005 | PASS | 非 active worker NoWork(reason=not_active_worker)：`docs/ssot/agent-remnote/ws-bridge-protocol.md`、`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` | 无 |
| FR-006 | PASS | TriggerStartSync 定向 active worker + sent=0 nextActions：`docs/ssot/agent-remnote/ws-bridge-protocol.md`、相关 CLI contract tests（sent=0 可见性） | 无 |
| FR-007 | PASS | ops.locked_by=connId：`packages/agent-remnote/src/internal/queue/dao.ts` | 无 |
| FR-008 | PASS | state file / Clients 结构含 connId/active worker 信息：`docs/ssot/agent-remnote/ws-bridge-protocol.md`、`packages/agent-remnote/tests/integration/ws-bridge-runtime.integration.test.ts` | 无 |
| FR-009 | PASS | read-rpc 路由隔离：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` | 无 |
| FR-010 | PASS | 文档与指引口径更新：`docs/ssot/agent-remnote/ws-bridge-protocol.md`、`docs/guides/ws-debug-and-testing.md`、`$CODEX_HOME/skills/remnote/SKILL.md` | 无 |
| NFR-001 | PASS | 无需用户配置实例标识：connId 服务端分配、clientInstanceId 自动生成：`docs/ssot/agent-remnote/ws-bridge-protocol.md` | 无 |
| NFR-002 | PASS | 选举稳定：lastSeenAt 仅 stale 过滤：`specs/003-ws-identity/spec.md`（不变量） + runtime 实现 | 无 |

## 漂移/缺口矩阵（聚焦问题）

- 无

## Next Actions（可选）

1) 若未来需要更强“多窗口/多端”回归保护，可把 active worker 迁移/接管场景补成更显式的 integration-ish tests（目前核心语义已由 010/013/009 的测试覆盖）。  

