# Contracts 005：WS read-rpc（SearchRequest/SearchResponse）

**Feature**: `specs/005-search-safety/spec.md`  
**Date**: 2026-01-24

> 说明：本契约建立在 Spec 003 的 vNext 连接身份之上（`connId + active worker`，移除 `consumerId`）。服务端用 `(callerConnId, requestId)`（或等价）做并发隔离与路由，不允许串包。

## SearchRequest（Caller → Server）

```json
{
  "type": "SearchRequest",
  "requestId": "uuid",
  "queryText": "string",
  "searchContextRemId": "optional-rem-id",
  "limit": 20,
  "timeoutMs": 3000
}
```

约束：

- `requestId` MUST 由调用方生成且在同一连接内唯一。
- `limit` 默认 20；最大 100；超出必须 clamp，并在 `budget.limitClamped=true` 表达。
- `timeoutMs` 默认 3000；最大 5000；超出必须 clamp。

## SearchResponse（Server → Caller）

### Success

```json
{
  "type": "SearchResponse",
  "requestId": "uuid",
  "ok": true,
  "budget": {
    "timeoutMs": 3000,
    "limitRequested": 20,
    "limitEffective": 20,
    "limitClamped": false,
    "maxPreviewChars": 200,
    "durationMs": 153
  },
  "results": [
    { "remId": "id", "title": "title", "snippet": "preview", "truncated": false }
  ]
}
```

### Error（示例：NO_ACTIVE_WORKER）

```json
{
  "type": "SearchResponse",
  "requestId": "uuid",
  "ok": false,
  "budget": {
    "timeoutMs": 3000,
    "limitRequested": 20,
    "limitEffective": 20,
    "limitClamped": false,
    "maxPreviewChars": 200,
    "durationMs": 4
  },
  "error": { "code": "NO_ACTIVE_WORKER", "message": "no active worker connection" },
  "nextActions": [
    "Switch to the target RemNote window to trigger a selection change",
    "Check that the plugin control channel is connected"
  ]
}
```

错误码建议集合（最小）：

- `NO_ACTIVE_WORKER`：无可用 active worker（插件不在线或不活跃）
- `TIMEOUT`：超时（插件侧或服务端等待超时）
- `PLUGIN_ERROR`：插件执行 read-rpc 出错（含校验失败）
- `BRIDGE_ERROR`：服务端内部错误（路由/关联/超时回收）
- `VALIDATION_ERROR`：调用方入参不合法（limit/timeout/query 为空等）

## 路由规则（服务端）

- SearchRequest MUST 仅转发给 active worker（由 Spec 003 定义的选举结果）。
- 若当前无 active worker：服务端直接返回 `SearchResponse(ok=false, error.code='NO_ACTIVE_WORKER')`。
- 服务端 MUST 在 `timeoutMs` 到达前回包（成功或超时错误），并清理 pending 记录（避免悬挂）。
