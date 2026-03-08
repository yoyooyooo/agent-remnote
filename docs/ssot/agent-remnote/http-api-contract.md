# Host API Contract（SSoT）

## TL;DR

- `agent-remnote api serve` 提供本机 Host API（默认 `http://0.0.0.0:3000`）。
- 该 API 面向“宿主机 + 本地容器 + 自己使用”的可信边界；当前版本不做鉴权。
- 容器内 agent 的标准入口是 HTTP API；CLI 也可通过 `--api-base-url` / `REMNOTE_API_BASE_URL` 进入 remote API mode。
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
- `plugin search`
- `plugin ui-context snapshot/page/focused-rem/describe`
- `plugin current`
  - recommended for agents: `plugin current --compact`
- `plugin selection snapshot/roots/current/outline`
  - recommended for selection-only flows: `plugin selection current --compact`
- `queue wait`
- `apply`
- `import markdown`

入口：

- 参数：`--api-base-url <url>`
- 环境变量：`REMNOTE_API_BASE_URL=<url>`

优先级：

- `--api-base-url` > `REMNOTE_API_BASE_URL` > direct mode

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
- `POST /v1/plugin/selection/outline`
- `POST /v1/search/db`
- `POST /v1/search/plugin`
- `POST /v1/write/ops`
- `POST /v1/write/markdown`
- `POST /v1/queue/wait`
- `GET /v1/queue/txns/:txnId`
- `POST /v1/actions/trigger-sync`

## Envelope

所有响应都使用与 CLI `--json` 一致的 envelope：

- success: `{ "ok": true, "data": ... }`
- failure: `{ "ok": false, "error": { "code", "message", "details" }, "hint"?: [] }`

## Read Next

- `docs/ssot/agent-remnote/cli-contract.md`
- `docs/ssot/agent-remnote/ws-bridge-protocol.md`
- `docs/ssot/agent-remnote/tools-write.md`
