# CLI Contract: 019-local-host-api-and-stack

## 新增命令组：`api`

> 裁决：`api` 命令组只负责 Host API 服务生命周期；不承载业务读写代理命令。

### `agent-remnote api serve`

语义：前台启动 Host API 长驻服务。

建议参数：

- `--host <host>`（默认 `0.0.0.0`）
- `--port <port>`（默认 `3000`，可由 `PORT` 覆盖）

### `agent-remnote api start`

语义：后台启动 Host API，并写入 `api.pid` / `api.log` / `api.state.json`。

### `agent-remnote api stop`

语义：停止由 `api start` / `api ensure` 拉起的后台 Host API 进程。

### `agent-remnote api status`

语义：输出 Host API 进程状态、HTTP 健康状态、推荐 base URLs、依赖 daemon 健康度。

### `agent-remnote api logs`

语义：查看 API 日志。

建议参数：

- `--lines <n>`（默认 200）

### `agent-remnote api restart`

语义：重启后台 Host API。

### `agent-remnote api ensure`

语义：若后台 Host API 不存在或不健康，则启动；若已健康，则 no-op。

## 新增命令组：`stack`

### `agent-remnote stack ensure`

语义：确保 `daemon + api` 都处于健康运行状态。

### `agent-remnote stack stop`

语义：停止 `daemon + api`。

### `agent-remnote stack status`

语义：聚合输出 `daemon + api + active worker + queue` 状态。

## 输出契约

- `--json` 模式下，stdout 继续保持单行 JSON envelope；stderr 为空。
- 对外错误 message / nextActions 必须为英文。
- `api` / `stack` 命令返回结构应与现有 daemon 风格保持一致，避免第二套运维口径。

## 业务命令的 Remote API Mode

以下现有业务命令必须支持 remote API mode（列表可扩展，但不能少于 spec 中 HTTP API 已覆盖的能力）：

- `search`
- `plugin search`
- `queue wait`
- 写入类命令（如 `apply` / `import markdown` 等）

统一入口：

- 参数：`--api-base-url <url>`
- 环境变量：`REMNOTE_API_BASE_URL=<url>`
- 用户配置文件：`~/.agent-remnote/config.json` 中的 `apiBaseUrl`
- 配置文件路径覆盖：`REMNOTE_CONFIG_FILE=<path>`

优先级：

- `--api-base-url` > `REMNOTE_API_BASE_URL` > `~/.agent-remnote/config.json`

语义：

- 一旦进入 remote API mode，命令必须调用宿主机 Host API，而不是直接访问本地 DB/WS/store。
- `agent-remnote api ...` 仍只表示“管理 API 服务本身”，不表示“通过 API 执行业务命令”。
