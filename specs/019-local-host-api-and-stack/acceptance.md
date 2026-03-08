# Acceptance: 019-local-host-api-and-stack

Date: 2026-03-08  
Spec: `specs/019-local-host-api-and-stack/spec.md`

## 验收结论

- 本 spec 已实现并通过本地自动化验证。
- 另外已在真实宿主机环境完成 smoke：重启 `daemon + api`、等待 active worker、对 `2026-03-08` 的今日 DN 做安全写入，并用真实插件搜索读回确认。
- 还额外验证了本地模式与 remote API mode 在以下能力上的一致性：
  - `search`
  - `queue wait`
  - `plugin search`
  - `plugin ui-context *`
  - `plugin selection *`
  - `plugin current --compact`

## 覆盖矩阵

### 功能需求（FR）

| ID | 结论 | 证据（实现/测试） | 备注 |
| --- | --- | --- | --- |
| FR-001 | PASS | `packages/agent-remnote/src/commands/index.ts`、`packages/agent-remnote/src/services/HostApiClient.ts`、`tests/contract/search-remote-api.contract.test.ts` | 容器/远端通过 Host API 调业务命令 |
| FR-002 | PASS | `packages/agent-remnote/src/commands/api/index.ts`、`tests/contract/api-stack-help.contract.test.ts` | `api` 命令组已提供完整生命周期子命令 |
| FR-003 | PASS | `packages/agent-remnote/src/commands/api/serve.ts`、`packages/agent-remnote/src/commands/api/start.ts`、`packages/agent-remnote/src/commands/api/stop.ts`、`tests/contract/api-lifecycle.contract.test.ts` | `serve` 前台，`start/stop` 后台 |
| FR-004 | PASS | `packages/agent-remnote/src/commands/stack/index.ts`、`tests/contract/api-stack-help.contract.test.ts` | `stack ensure/stop/status` 已落地 |
| FR-005 | PASS | `packages/agent-remnote/src/services/Config.ts`、`packages/agent-remnote/src/services/CliConfigProvider.ts`、`tests/contract/api-lifecycle.contract.test.ts` | 默认 `0.0.0.0:3000`，支持 `PORT` 覆盖 |
| FR-006 | PASS | `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts`、`tests/contract/api-lifecycle.contract.test.ts`、`tests/contract/plugin-ui-context-remote-api.contract.test.ts`、`tests/contract/plugin-selection-remote-api.contract.test.ts` | 核心 HTTP endpoints 已实现，且扩展了 `plugin/*` 对等接口 |
| FR-007 | PASS | `packages/agent-remnote/src/services/Errors.ts`、`packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts` | HTTP/CLI 共用 envelope 与错误码 |
| FR-008 | PASS | `packages/agent-remnote/src/lib/hostApiUseCases.ts` | API 复用共享 usecase，未通过 shell 调 CLI |
| FR-009 | PASS | `packages/agent-remnote/src/services/ApiDaemonFiles.ts`、`tests/contract/api-lifecycle.contract.test.ts` | `api.pid` / `api.log` / `api.state.json` 已落地 |
| FR-010 | PASS | `packages/agent-remnote/src/commands/stack/ensure.ts`、`tests/contract/stack-ensure-wait-worker.contract.test.ts` | `stack ensure` 能保证 `daemon + api`，并支持 `--wait-worker` |
| FR-011 | PASS | `packages/agent-remnote/src/commands/apply.ts`、`packages/agent-remnote/src/commands/import/markdown.ts`、真实 smoke | 写入仍走 queue / plugin 执行链路 |
| FR-012 | PASS | `packages/agent-remnote/src/commands/read/search.ts`、`packages/agent-remnote/src/commands/queue/wait.ts`、`tests/contract/search-remote-api.contract.test.ts`、`tests/contract/queue-wait-remote-api.contract.test.ts` | 业务 CLI 已支持 `--api-base-url` / `REMNOTE_API_BASE_URL` |
| FR-013 | PASS | `packages/agent-remnote/src/services/HostApiClient.ts`、相关 remote tests | remote mode 下通过 Host API 调用，不直接碰本地 DB/WS |
| FR-014 | PASS | `README.md`、`README.zh-CN.md`、`docs/ssot/agent-remnote/http-api-contract.md`、`docs/runbook/local-host-api.md` | 文档已同步 |

### 非功能需求（NFR）

| ID | 结论 | 证据（实现/测试） | 备注 |
| --- | --- | --- | --- |
| NFR-001 | PASS | 默认无 auth、本机 smoke 成功 | 以本机自用体验优先 |
| NFR-002 | PASS | `agent-remnote stack ensure` + `tests/contract/api-lifecycle.contract.test.ts` | 一条命令可完成最小闭环 |
| NFR-003 | PASS | 全量 `npm test --workspace agent-remnote` 通过 | CLI 既有 machine surface 未回归 |
| NFR-004 | PASS | 错误文案 / nextActions / HTTP envelope 为英文 | 与项目约定一致 |
| NFR-005 | PASS | SSoT + forward-only spec + fail-fast 错误码 | 无长期兼容层 |

### 成功标准（SC）

| ID | 结论 | 证据 | 备注 |
| --- | --- | --- | --- |
| SC-001 | PASS | 真实 smoke：`stack ensure` 后 `http://127.0.0.1:3000/v1/health` 可用；`api.state.json` 暴露 containerBaseUrl | 容器口径也已在 contract/integration 中覆盖 |
| SC-002 | PASS | 真实 smoke：对 `2026-03-08` 的今日 DN 写入成功，并由真实插件搜索读回 | 无需挂载 `remnote.db` / `store.sqlite` 到容器 |
| SC-003 | PASS | `daemon` / `api` / `stack` 命令面均已实现并通过合同测试 | 排障入口已分层 |
| SC-004 | PASS | Host API / CLI 共用 `Errors.ts` 与共享 usecase；remote/local contract tests 均通过 | 未出现第二套语义漂移 |

## 验证命令

```bash
npm run typecheck --workspace agent-remnote
npm test --workspace agent-remnote
```

最终结果：

- `89` 个测试文件通过
- `176` 个测试通过

## 真实 Smoke（摘要）

- `agent-remnote stack stop`
- `agent-remnote --json stack ensure --wait-worker --worker-timeout-ms 15000`
- `curl http://127.0.0.1:3000/v1/health`
- `agent-remnote --json daily write --text "[agent-remnote real smoke @ 2026-03-08 16:44:44 +0800] Host API stack restart + daily DN write ok" --date "2026-03-08" --create-if-missing --wait --timeout-ms 30000 --poll-ms 500 --idempotency-key "manual-test:daily:2026-03-08:*"`
- `agent-remnote --json plugin search --query "Host API stack restart + daily DN write ok" --limit 5 --timeout-ms 3000 --no-ensure-daemon`
- `agent-remnote --json plugin current --compact`
- `agent-remnote --json --api-base-url http://127.0.0.1:3000 plugin current --compact`

## Next Actions

- 若后续要继续增强 Agent 读上下文体验，可考虑增加 `plugin current --watch`。
- 若要给容器做更稳定的准备门槛，当前已推荐使用：`stack ensure --wait-worker`。
