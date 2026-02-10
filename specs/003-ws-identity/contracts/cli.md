# Contracts 003：CLI（移除 consumerId，转向 active worker）

**Feature**: `specs/003-ws-identity/spec.md`  
**Date**: 2026-01-24

## Breaking changes（forward-only）

- 移除根级 option：`--consumer-id`
- 移除/废弃 env：`REMNOTE_CONSUMER_ID`（以及任何等价别名）
- `ws sync` 不再支持按 consumerId 定向；默认触发 active worker

## 命令行为（建议口径）

### `agent-remnote ws sync`

- 行为：发送 `{ type: 'TriggerStartSync' }`，由服务端转发给 active worker
- 输出增强（建议）：
  - `activeConnId`（若 sent=1）
  - sent=0 时返回 `reason='no_active_worker'` + `nextActions[]`

### `agent-remnote ws status` / `agent-remnote read connections`

输出增强（建议字段）：

- `connId`
- `clientInstanceId`
- `clientType`
- `capabilities`
- `isActiveWorker`
- `lastSeenAt / lastSelectionAt / lastUiContextAt`（或等价字段）

### 调试定向（可选）

如确有需求（仅限调试），可新增：

- `--conn-id <uuid>`：仅用于诊断/实验（例如向指定 connId 发送 StartSync 或 read-rpc），不作为常规用户心智模型的一部分。

## 文档同步（必须）

- 更新 `docs/ssot/agent-remnote/ws-bridge-protocol.md`：移除 `consumerId`，引入 `connId + active worker`。
- 更新 `docs/guides/ws-debug-and-testing.md`：把调试示例从 consumerId 改为 vNext。
