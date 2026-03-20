# Tasks: 021-host-api-remote-surface-and-workspace-binding

## Workstream A：通用远程 surface 收口

- [x] T001 打通 `apiBasePath` 配置到 Host API client：修改 `packages/agent-remnote/src/services/HostApiClient.ts` 与 `packages/agent-remnote/src/lib/apiUrls.ts`，去掉硬编码 `/v1`
- [x] T002 打通 `apiBasePath` 到 HTTP runtime：修改 `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts`，让所有路由基于配置前缀注册与匹配
- [x] T003 打通 `apiBasePath` 到状态文件与命令输出：修改 `packages/agent-remnote/src/lib/hostApiUseCases.ts`、`packages/agent-remnote/src/services/ApiDaemonFiles.ts`、`packages/agent-remnote/src/commands/api/status.ts`、`packages/agent-remnote/src/commands/stack/status.ts`
- [x] T004 增补 `apiBasePath` 契约测试：新增或更新 `packages/agent-remnote/tests/unit/host-api-client.unit.test.ts` 与 `packages/agent-remnote/tests/contract/api-lifecycle.contract.test.ts`
- [x] T004A 固化 remote mode 单一开关语义：增加测试覆盖“只有 `apiBaseUrl` 会开启 remote mode，`apiHost` / `apiPort` / `apiBasePath` 单独存在时仍保持 direct mode”

## Workstream B：Store DB 持久化 workspace binding

- [x] T005 固化 Store schema 扩展：基于 `specs/021-host-api-remote-surface-and-workspace-binding/data-model.md` 最终确认 `workspace_bindings` / `currentWorkspaceId` 所需字段与约束
- [x] T006 新增 Store migration：新增 `packages/agent-remnote/src/internal/store/migrations/0006-add-workspace-bindings.ts`
- [x] T007 接线 migration 索引：更新 `packages/agent-remnote/src/internal/store/migrations/index.ts`
- [x] T008 扩展内置 fallback schema：更新 `packages/agent-remnote/src/internal/store/db.ts` 中的 fallback schema snapshot，避免 bundling 后 schema 漂移
- [x] T009 新增 workspace binding 持久化 service：新增 `packages/agent-remnote/src/services/WorkspaceBindings.ts`
- [x] T010 为 workspace binding service 增加单元测试：新增 `packages/agent-remnote/tests/unit/workspace-bindings.unit.test.ts`

## Workstream C：确定性 workspace / DB 解析器

- [x] T011 新增统一 resolver：新增 `packages/agent-remnote/src/lib/workspaceResolver.ts`，实现解析优先级、候选枚举、binding 命中、unresolved 诊断
- [x] T012 把 live `uiContext.kbId` 自动绑定逻辑下沉到 resolver / service：复用 `packages/agent-remnote/src/commands/read/uiContext/_shared.ts` 的现有 snapshot 数据
- [x] T013 替换 `hostApiUseCases` 中散落的 `kbId -> dbPath` 推断：修改 `packages/agent-remnote/src/lib/hostApiUseCases.ts`
- [x] T014 替换命令层散落的 workspace 推断：优先覆盖 `packages/agent-remnote/src/commands/read/outline.ts`、`packages/agent-remnote/src/commands/read/page-id.ts`、`packages/agent-remnote/src/commands/read/uiContext/describe.ts`
- [x] T015 让 deep link / 显式 `workspaceId` 能命中 resolver：更新 `packages/agent-remnote/src/lib/remnote.ts` 与相关命令 / use case
- [x] T016 为多候选 unresolved 行为增加 contract tests：新增 `packages/agent-remnote/tests/contract/workspace-resolution.contract.test.ts`

## Workstream D：capability-aware 状态与错误模型

- [x] T017 扩展 API health / status use case：修改 `packages/agent-remnote/src/lib/hostApiUseCases.ts`，加入 capability 状态与 workspace 解析状态
- [x] T017A 固化端点分层矩阵：在 `docs/ssot/agent-remnote/http-api-contract.md` 与 021 spec 中明确 `no_binding` / `binding_snapshot_only` / `db_resolver_required`
- [x] T018 扩展 `api.state.json` 运行时快照：更新 `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts` 与 `packages/agent-remnote/src/services/ApiDaemonFiles.ts`，写入 `basePath` 与通用访问语义字段
- [x] T019 为 Host API 定义稳定错误码：补充 `WORKSPACE_UNRESOLVED`、`PLUGIN_UNAVAILABLE`、`WRITE_UNAVAILABLE`、`UI_SESSION_UNAVAILABLE` 等边界，并统一到 `packages/agent-remnote/src/services/Errors.ts`
- [x] T020 更新 `api status` / `stack status` 输出：修改 `packages/agent-remnote/src/commands/api/status.ts` 与 `packages/agent-remnote/src/commands/stack/status.ts`
- [x] T021 为 capability / unresolved / readiness 增加 contract tests：新增 `packages/agent-remnote/tests/contract/api-status-capabilities.contract.test.ts`
- [x] T021A 为“不是所有端点都走 resolver”增加测试：新增 contract / unit tests，断言 `queue wait` / `queue txn` / `health` 不依赖 DB 解析，而 `search/db` / `read/outline` / `daily/rem-id` 必须走 resolver

## Workstream E：远程命令矩阵、测试与文档

- [x] T022 固化 remote-capable 命令矩阵：更新 `docs/ssot/agent-remnote/http-api-contract.md`，明确 remote-capable / host-only 命令边界与 workspace 参数语义
- [x] T023 更新 Host API / workspace 持久化 SSoT：新增或更新 `docs/ssot/agent-remnote/ui-context-and-persistence.md` 与 `docs/ssot/agent-remnote/README.md`
- [x] T024 更新 Store schema 文档：在 `docs/ssot/agent-remnote/queue-schema.md` 中补充 workspace binding 所在位置，或拆出新的 `store-schema.md`
- [x] T025 更新用户文档：修改 `README.md`、`README.zh-CN.md`、`docs/runbook/local-host-api.md`，把 `apiBaseUrl` 作为统一远程入口，弱化 container-only 表述
- [x] T026 新增 quickstart：新增 `specs/021-host-api-remote-surface-and-workspace-binding/quickstart.md`，覆盖“首次自动绑定”“多候选 unresolved”“非默认 base path”三条验收路径
- [x] T027 完成 acceptance：新增 `specs/021-host-api-remote-surface-and-workspace-binding/acceptance.md`

## 建议测试顺序

- [x] T028 先跑 unit：`workspace bindings`、`host api client`
- [x] T029 再跑 contract：`api status`、`workspace resolution`、`api base path`
- [x] T030 最后做本机 smoke：验证已有 `kbId` 触发 binding、插件暂离线后 DB read 仍命中同一 workspace（见 `specs/021-host-api-remote-surface-and-workspace-binding/acceptance.md` 的 Smoke 摘要）
