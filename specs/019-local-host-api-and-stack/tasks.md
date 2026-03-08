# Tasks: 019-local-host-api-and-stack

## Workstream A：共享能力层

- [x] T001 新增共享 use case 入口：在 `packages/agent-remnote/src/lib/hostApiUseCases.ts` 建立 `health/status/uiContext/selection/search/write/queueWait` 等共享逻辑
- [x] T002 抽取 CLI 复用逻辑：把现有命令中的核心逻辑下沉到共享 use cases，避免 HTTP API 通过 shell 调 CLI
- [x] T003 统一 envelope / error model：复用 `packages/agent-remnote/src/services/Errors.ts`，保证 CLI 与 HTTP 错误码/英文 message/nextActions 一致
- [x] T003A 为业务 CLI 增加 remote API mode 解析：统一支持 `--api-base-url` 与 `REMNOTE_API_BASE_URL`，并实现参数优先级高于环境变量

## Workstream B：Host API Runtime

- [x] T004 新增 API 配置解析：在 `packages/agent-remnote/src/services/Config.ts` / `packages/agent-remnote/src/services/CliConfigProvider.ts` 加入 `apiHost/apiPort/apiPidFile/apiLogFile/apiStateFile/apiBaseUrl`
- [x] T005 新增 API daemon 文件服务：新增 `packages/agent-remnote/src/services/ApiDaemonFiles.ts`
- [x] T006 新增 API runtime：新增 `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts`
- [x] T007 新增 HTTP 路由层：在 `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts` 实现 `health/status/ui-context/selection/search/write/queue` 与 `plugin/*` 路由
- [x] T008 新增 `api serve` 命令：`packages/agent-remnote/src/commands/api/serve.ts`
- [x] T009 新增 `api start/stop/status/logs/restart/ensure` 命令：`packages/agent-remnote/src/commands/api/*.ts`
- [x] T010 把 `api` 命令组接入主 CLI：更新 `packages/agent-remnote/src/commands/index.ts` 与 `packages/agent-remnote/src/main.ts`
- [x] T010A 让现有业务命令可切换 remote API mode：在命令执行层接入 Host API client，而不是新增 `agent-remnote api <business>` 子命令

## Workstream C：Stack 命令面

- [x] T011 新增 `stack ensure/stop/status` 命令：`packages/agent-remnote/src/commands/stack/*.ts`
- [x] T012 实现 stack 聚合状态：复用 daemon + api 状态查询，聚合 active worker / queue stats
- [x] T013 确保 `stack ensure` 会先保证 daemon，再保证 api；并支持 `--wait-worker`

## Workstream D：契约与测试

- [x] T014 新增 CLI contract tests：覆盖 `api` / `stack` 的 `--json` 输出纯度、退出码、命令帮助与默认值
- [x] T014A 新增 remote API mode contract tests：覆盖 `--api-base-url`、`REMNOTE_API_BASE_URL`、参数覆盖环境变量、direct/remote mode 切换
- [x] T015 新增 HTTP contract tests：覆盖 `/v1/health`、`/v1/status`、`/v1/search/db`、`/v1/search/plugin`、`/v1/write/ops`、`/v1/queue/wait`，以及 `plugin/current|selection|ui-context` 远端模式
- [x] T016 新增 integration / smoke 验证：验证 `stack ensure` 后容器侧等价 base URL（`host.docker.internal` 口径）与本机 `127.0.0.1` 口径，并做真实宿主机 smoke

## Workstream E：文档与验收

- [x] T017 更新 `README.md`：新增 `api` / `stack` 命令、部署图、默认端口与本机/容器访问说明
- [x] T018 更新 `README.zh-CN.md`：同步中文口径
- [x] T019 新增/更新 SSoT：补 `docs/ssot/agent-remnote/http-api-contract.md` 与 `docs/ssot/agent-remnote/README.md` 索引
- [x] T020 新增 runbook：`docs/runbook/local-host-api.md`，覆盖启动、停止、日志、常见故障与 base URL 选择
- [x] T021 完成 `specs/019-local-host-api-and-stack/quickstart.md` 的本地验收并把证据写入 `specs/019-local-host-api-and-stack/acceptance.md`
