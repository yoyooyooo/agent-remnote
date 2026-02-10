# Contracts 003：WS 协议 vNext（connId + active worker，移除 consumerId）

**Feature**: `specs/003-ws-identity/spec.md`  
**Date**: 2026-01-24

> 目标：让“连接实例是谁 / 谁能消费队列 / read-rpc 路由到哪”变得无歧义且可诊断。本契约为 forward-only，不提供旧协议兼容层。

## 1) 握手与注册

### Hello / HelloAck

- Client → Server：

```json
{ "type": "Hello" }
```

- Server → Client：

```json
{ "type": "HelloAck", "ok": true, "connId": "uuid" }
```

约束：

- `connId` MUST 由服务端生成（UUID）。

### Register / Registered

- Client → Server：

```json
{
  "type": "Register",
  "clientType": "remnote-plugin|cli|debug",
  "clientInstanceId": "uuid-or-null",
  "capabilities": { "control": true, "worker": true, "readRpc": true }
}
```

- Server → Client：

```json
{ "type": "Registered", "connId": "uuid" }
```

约束：

- 协议中 MUST 不再出现 `consumerId` 字段。
- `capabilities.worker=true` 的连接才会进入 active worker 候选集。

## 2) UI 运行态推送（control）

沿用现有 `SelectionChanged` / `UiContextChanged` 消息形状（字段细节见 `docs/ssot/agent-remnote/ui-context-and-persistence.md`）。

服务端要求：

- 收到消息时更新该连接的 `selection.updatedAt/uiContext.updatedAt`（写入 `Date.now()`）并触发 active worker 重新选举（如需要）。

## 3) 写入消费（worker）

### RequestOp

- Client → Server：

```json
{ "type": "RequestOp", "leaseMs": 30000 }
```

### NoWork（非 active worker / 无任务）

- Server → Client（非 active worker）：

```json
{ "type": "NoWork", "reason": "not_active_worker", "activeConnId": "uuid" }
```

- Server → Client（active worker 且无任务）：

```json
{ "type": "NoWork", "reason": "empty" }
```

约束：

- 服务端 MUST 仅允许 active worker 拉取任务；非 active worker 不得收到 `OpDispatch`。
- 服务端写入 `ops.locked_by` 时 MUST 写入 active worker 的 `connId`。

## 4) 同步触发（kick）

- Producer/CLI → Server：

```json
{ "type": "TriggerStartSync" }
```

- Server → active worker：

```json
{ "type": "StartSync" }
```

- Server → Producer/CLI：

```json
{ "type": "StartSyncTriggered", "sent": 1, "activeConnId": "uuid" }
```

若无 active worker：

```json
{
  "type": "StartSyncTriggered",
  "sent": 0,
  "reason": "no_active_worker",
  "nextActions": [
    "Switch to the target RemNote window to trigger a selection change",
    "Check that the plugin control channel is connected"
  ]
}
```

## 5) 状态查询（诊断）

### QueryClients / Clients

- Client → Server：

```json
{ "type": "QueryClients" }
```

- Server → Client：

```json
{
  "type": "Clients",
  "clients": [
    {
      "connId": "uuid",
      "clientType": "remnote-plugin|cli|debug",
      "clientInstanceId": "uuid-or-null",
      "capabilities": { "control": true, "worker": true, "readRpc": true },
      "isActiveWorker": true,
      "connectedAt": 0,
      "lastSeenAt": 0,
      "selection": { "totalCount": 1, "truncated": false, "remIds": ["..."], "updatedAt": 0 },
      "uiContext": { "pageRemId": "...", "focusedRemId": "...", "updatedAt": 0 }
    }
  ]
}
```

### WhoAmI / YouAre

- Client → Server：

```json
{ "type": "WhoAmI" }
```

- Server → Client：

```json
{ "type": "YouAre", "connId": "uuid", "clientType": "remnote-plugin|cli|debug", "lastSeenAt": 0 }
```
