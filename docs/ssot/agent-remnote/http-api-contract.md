# Host API Contract（SSoT）

## TL;DR

- `agent-remnote api serve` 提供本机 Host API（默认 `http://0.0.0.0:3000`）。
- 该 API 面向“宿主机 + 本地容器 + 自己使用”的可信边界；当前版本不做鉴权。
- 容器内 agent 的标准入口是 HTTP API；业务 CLI 应保持同一套命令形状，remote API mode 通过用户配置层注入。
- `api` 命令组只负责 API 生命周期；业务命令仍保留原命令名。

## 角色与边界

- `daemon`：继续作为 plugin / WS / queue 的 control plane。
- `api`：对宿主机与容器内 agent 暴露 HTTP/JSON surface。
- `stack`：聚合 `daemon + api` 生命周期。
- 禁止通过 Host API 绕过 `queue -> WS -> plugin SDK` 写入链路。

## 默认监听与访问地址

- Listen host：`0.0.0.0`
- Listen port：`3000`（可由 `PORT` 覆盖）
- 宿主机访问：`http://127.0.0.1:3000`
- 容器访问：`http://host.docker.internal:3000`

## 生命周期命令

- `agent-remnote api serve`
- `agent-remnote api start`
- `agent-remnote api stop`
- `agent-remnote api restart`
- `agent-remnote api ensure`
- `agent-remnote api status`
- `agent-remnote api logs`
- `agent-remnote stack ensure`
  - optional: `--wait-worker --worker-timeout-ms <ms>`
- `agent-remnote stack stop`
- `agent-remnote stack status`

## Remote API Mode

以下业务命令必须支持 remote API mode：

- `search`
- `rem outline`
- `daily rem-id`
- `plugin search`
- `plugin ui-context snapshot/page/focused-rem/describe`
- `plugin current`
  - recommended for agents: `plugin current --compact`
- `plugin selection snapshot/roots/current/outline`
  - recommended for selection-only flows: `plugin selection current --compact`
- `queue wait`
- `apply`
- `rem children append`
- `rem children prepend`
- `rem children replace`
- `rem children clear`
- `daily write`

入口：

- 参数：`--api-base-url <url>`
- 环境变量：`REMNOTE_API_BASE_URL=<url>`
- 用户配置文件：`~/.agent-remnote/config.json` 中的 `apiBaseUrl`
- 配置文件路径覆盖：`REMNOTE_CONFIG_FILE=<path>`

优先级：

- `--api-base-url` > `REMNOTE_API_BASE_URL` > `~/.agent-remnote/config.json` > direct mode

严格 remote mode：

- 一旦配置 `apiBaseUrl`，业务命令必须优先走宿主机 Host API。
- 仍依赖本地 DB 或本地文件系统的命令必须 fail fast，禁止静默回落到本地读取。
- 若某个业务命令尚无等价 Host API 能力，应返回稳定错误并提示用户在宿主机执行。

## HTTP Endpoints

- `GET /v1/health`
- `GET /v1/status`
- `GET /v1/ui-context`
- `GET /v1/selection`
- `GET /v1/plugin/ui-context/snapshot`
- `GET /v1/plugin/ui-context/page`
- `GET /v1/plugin/ui-context/focused-rem`
- `GET /v1/plugin/ui-context/describe`
- `GET /v1/plugin/selection/snapshot`
- `GET /v1/plugin/selection/roots`
- `GET /v1/plugin/selection/current`
- `GET /v1/plugin/current`
- `GET /v1/daily/rem-id`
- `POST /v1/plugin/selection/outline`
- `POST /v1/read/outline`
- `POST /v1/search/db`
- `POST /v1/search/plugin`
- `POST /v1/write/apply`
- `POST /v1/queue/wait`
- `GET /v1/queue/txns/:txnId`
- `POST /v1/actions/trigger-sync`

## Host API write flows

- Host API canonical write route reuses the same enqueue pipeline as the CLI.
- The route accepts the same apply envelope used by `agent-remnote apply --payload`.
- `ensureDaemon=true` means the request may invoke daemon lifecycle helpers before notifying the active worker.
- The runtime must inject daemon runtime services used by enqueue helpers, including `DaemonFiles`, `Process`, and `SupervisorState`.
- Missing daemon runtime services are considered a server bug and must not be silently ignored.

## Envelope

所有响应都使用与 CLI `--json` 一致的 envelope：

- success: `{ "ok": true, "data": ... }`
- failure: `{ "ok": false, "error": { "code", "message", "details" }, "hint"?: [] }`

## Read Next

- `docs/ssot/agent-remnote/cli-contract.md`
- `docs/ssot/agent-remnote/ws-bridge-protocol.md`
- `docs/ssot/agent-remnote/tools-write.md`
