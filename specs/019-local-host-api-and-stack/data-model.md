# Data Model: Local Host API + Stack (019)

## Runtime 角色

### Host Runtime（authoritative）

- `daemon`：WS bridge / plugin control plane / queue dispatch / UI state
- `api`：HTTP/JSON front door for local host + container agents
- `store.sqlite`：写入队列与持久化状态
- `remnote.db`：官方只读 DB

### Container Runtime（client-only）

- 仅通过 HTTP API 调用宿主机能力
- 不直接访问 `remnote.db` / `store.sqlite` / WS bridge

## 新增配置项

### Host API listen config

- `host`: 默认 `0.0.0.0`
- `port`: 默认 `3000`
- `basePath`: 默认 `/v1`

建议环境变量：

- `PORT`：覆盖默认端口
- `REMNOTE_API_HOST`：覆盖默认 host
- `REMNOTE_API_BASE_URL`：让业务 CLI 走 remote API mode
- `REMNOTE_API_PID_FILE`
- `REMNOTE_API_LOG_FILE`
- `REMNOTE_API_STATE_FILE`

## CLI 运行模式

### Direct Mode（默认）

- 未提供 `--api-base-url` / `REMNOTE_API_BASE_URL`
- CLI 直接访问本地 `remnote.db`、`store.sqlite`、WS bridge

### Remote API Mode

- 提供 `--api-base-url` 或 `REMNOTE_API_BASE_URL`
- CLI 不再直接访问本地 RemNote 相关文件与 WS bridge
- CLI 改为通过宿主机 Host API 完成读写与状态查询

优先级：

- `--api-base-url` > `REMNOTE_API_BASE_URL` > direct mode

## 新增状态文件

- `~/.agent-remnote/api.pid`
- `~/.agent-remnote/api.log`
- `~/.agent-remnote/api.state.json`

### `api.state.json`（建议字段）

```json
{
  "running": true,
  "pid": 12345,
  "host": "0.0.0.0",
  "port": 3000,
  "basePath": "/v1",
  "startedAt": 1772937600000,
  "localBaseUrl": "http://127.0.0.1:3000",
  "containerBaseUrl": "http://host.docker.internal:3000",
  "daemon": {
    "healthy": true,
    "wsUrl": "ws://localhost:6789/ws"
  }
}
```

## StackStatus（聚合状态）

```json
{
  "daemon": {
    "running": true,
    "healthy": true
  },
  "api": {
    "running": true,
    "healthy": true,
    "localBaseUrl": "http://127.0.0.1:3000",
    "containerBaseUrl": "http://host.docker.internal:3000"
  },
  "activeWorkerConnId": "uuid-or-null",
  "queue": {
    "pending": 0,
    "in_flight": 0
  }
}
```

## HTTP Envelope（与 CLI 对齐）

成功：

```json
{ "ok": true, "data": { "...": "..." } }
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "WS_UNAVAILABLE",
    "message": "Failed to connect to ws bridge",
    "details": {},
    "nextActions": ["agent-remnote daemon status --json"]
  }
}
```

## HTTP 状态码（建议）

- `200`：业务成功
- `400`：参数错误 / invalid request
- `404`：资源不存在（如 txn 不存在）
- `409`：状态冲突
- `503`：依赖不可用（daemon / plugin / db）
- `500`：未知运行时错误
