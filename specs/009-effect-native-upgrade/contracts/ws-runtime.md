# Contract: WS Runtime as Effect Actor（daemon/ws-bridge）

**Date**: 2026-01-25  
**Spec**: `specs/009-effect-native-upgrade/spec.md`

## Target Properties

- ws-bridge 的 mutable state 由单一 Actor fiber 持有（串行处理事件）
- 心跳/踢人/超时/状态写入节流全部由 Effect 调度
- 协议允许 forward-only 演进（可 breaking）：如有变更，必须同步更新 `docs/ssot/agent-remnote/ws-bridge-protocol.md` 并提供显式的版本校验/失败快显（不做向后兼容层）
- ws-bridge 必须拆分为：`kernel/**`（协议/选举/状态机）+ `runtime/**`（Actor 解释器）+ `services/**`（WS/FS/QueueRepo/Tmux 等平台边界），遵守 `specs/009-effect-native-upgrade/contracts/portable-kernel-and-actors.md`

## Required Behaviors (non-exhaustive)

- Active worker 选举口径默认保持一致（以 selection/uiContext 活跃度为主，不被心跳抖动驱动）；如需调整，必须同步更新 SSoT 与 contract tests
- 任何 WS 协议语义变化必须显式记录到 SSoT（禁止“实现漂移但文档不变”）
- state file 语义必须单一且可诊断；如有变更，必须同步更新 `docs/ssot/agent-remnote/**` 与相关 tests（允许字段增量扩展）
- statusLine 更新不再由分散的触发点直接执行副作用；应发布事件并由 StatusLineController 收口

## Optional: Cross-process refresh message

为满足 `FR-007`，009 允许新增一个轻量消息用于“请求 daemon 合并刷新 statusLine”：

- CLI → daemon：`{ "type": "StatusLineInvalidate" }`
- daemon：仅发布事件给 StatusLineController，并返回 ack（不触发额外业务副作用）
- 若 daemon 不可达：CLI 走本地 fallback（写 statusLine 文件 + best-effort `tmux refresh-client -S`）

如引入该消息，必须同步更新 `docs/ssot/agent-remnote/ws-bridge-protocol.md` 与相关 tests。
