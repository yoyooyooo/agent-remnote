# Data Model 003：WS 连接身份与 active worker

**Feature**: `specs/003-ws-identity/spec.md`  
**Date**: 2026-01-24

## Identity

### `connId`（server-assigned）

- 类型：`string`（UUID）
- 生命周期：单条 WS 连接；断线重连会变化
- 用途：路由、诊断、队列锁归属（`ops.locked_by`）

### `clientInstanceId`（plugin-assigned, persisted）

- 类型：`string`（UUID）
- 生命周期：插件本地持久化；跨重连保持稳定
- 用途：诊断归因（“是哪一个插件实例/窗口环境”）

## Capabilities

> 用于把连接角色显式化，避免把 CLI/debug 连接纳入 worker 选举。

| 字段 | 类型 | 说明 |
|---|---|---|
| `control` | boolean | 是否会上报 selection/uiContext |
| `worker` | boolean | 是否参与 active worker 候选集（消费队列/执行 read-rpc） |
| `readRpc` | boolean | 是否支持 read-rpc（如 SearchRequest） |

## Active Worker

### 活跃度时间戳（activityAt）

对每个连接维护：

- `lastSeenAt`：心跳/消息触发的最近活跃时间（由服务端更新）
- `selection.updatedAt`：最近一次 selection 上报时间（由服务端接收时写入 `Date.now()`）
- `uiContext.updatedAt`：最近一次 uiContext 上报时间（同上）

定义：

```text
activityAt = max(
  uiContext.updatedAt ?? 0,
  selection.updatedAt ?? 0
)
```

> Note: `lastSeenAt` is intentionally excluded from ordering to avoid election flapping caused by heartbeats.

### 候选集合与 staleness

- 候选集合：`capabilities.worker === true` 的连接
- staleness：`now - lastSeenAt > STALE_MS` 视为 stale，不得成为 active worker
- 推荐默认：`STALE_MS = 90_000`（与 heartbeat/UX 结合后可调整）

### 选举规则（确定性）

1) 过滤 stale 连接  
2) 取 `activityAt` 最大者作为 active worker  
3) 若并列：按 `connectedAt` 更晚者优先；再并列按 `connId` 字典序（保证确定性）

服务端应将：

- `isActiveWorker`（boolean）写入每个 client 的诊断快照
- 可选：额外写 `activeWorkerConnId` 顶层字段（便于 CLI 快速读取）

## State File（`~/.agent-remnote/ws.bridge.state.json`）建议形状（vNext）

```json
{
  "updatedAt": 0,
  "server": { "port": 6789, "path": "/ws" },
  "activeWorkerConnId": "uuid-or-null",
  "clients": [
    {
      "connId": "uuid",
      "clientType": "remnote-plugin|cli|debug",
      "clientInstanceId": "uuid-or-null",
      "capabilities": { "control": true, "worker": true, "readRpc": true },
      "isActiveWorker": true,
      "connectedAt": 0,
      "lastSeenAt": 0,
      "remoteAddr": "127.0.0.1",
      "userAgent": "string",
      "selection": { "totalCount": 1, "truncated": false, "remIds": ["..."], "updatedAt": 0 },
      "uiContext": { "pageRemId": "...", "focusedRemId": "...", "updatedAt": 0 }
    }
  ]
}
```

## Queue Lock Semantics

- `ops.locked_by` 字段不变（TEXT），但语义从 “consumerId” 演进为 **`connId`**。
- 诊断与恢复口径必须以 `connId` 为准（例如“哪个连接锁住了 op”）。
