# Acceptance: 021-host-api-remote-surface-and-workspace-binding

Date: 2026-03-19  
Spec: `specs/021-host-api-remote-surface-and-workspace-binding/spec.md`

## 验收状态

- 当前状态：PASS
- 自动化证据：
  - `tests/unit/workspace-bindings.unit.test.ts`
  - `tests/contract/workspace-resolution.contract.test.ts`
  - `tests/contract/api-status-capabilities.contract.test.ts`
  - `tests/contract/api-binding-scope.contract.test.ts`
  - `tests/contract/api-lifecycle.contract.test.ts`
  - `tests/unit/host-api-client.unit.test.ts`
- 本机 smoke：
  - `npm run dev --workspace agent-remnote -- --json stack stop`
  - `npm run dev --workspace agent-remnote -- --json --api-port 3011 --api-base-path /remnote/v1 stack ensure`
  - `npm run dev --workspace agent-remnote -- --json --api-port 3011 --api-base-path /remnote/v1 api status`
  - `npm run dev --workspace agent-remnote -- --json --api-port 3011 --api-base-path /remnote/v1 stack status`
  - `npm run dev --workspace agent-remnote -- --json daemon stop`
  - `npm run dev --workspace agent-remnote -- --json --api-port 3011 --api-base-path /remnote/v1 api status`
  - `npm run dev --workspace agent-remnote -- --json --api-base-url http://127.0.0.1:3011/remnote/v1 search --query yoyo --limit 1`
  - `npm run dev --workspace agent-remnote -- --json --api-port 3011 --api-base-path /remnote/v1 stack ensure`

## Smoke 摘要

- 非默认 `apiBasePath=/remnote/v1` 下：
  - `stack ensure` 返回 `base_url=http://127.0.0.1:3011/remnote/v1`
  - `api status` / `stack status` 都返回 `base_path=/remnote/v1`
- live `uiContext.kbId` 已真实命中：
  - `currentWorkspaceId=60810ee78b0e5400347f6a8c`
  - `currentDbPath=/Users/<redacted>/remnote/remnote-60810ee78b0e5400347f6a8c/remnote.db`
  - `bindingSource=live_ui_context`
- daemon 暂离线后：
  - `plugin_rpc_ready=false`
  - `write_ready=false`
  - `db_read_ready=true`
  - `resolutionSource=binding`
  - remote `search` 仍成功返回目标 workspace 的 DB 结果

## 覆盖矩阵

### 功能需求（FR）

| ID | 当前状态 | 证据 |
| --- | --- | --- |
| FR-001 | PASS | `HostApiClient.ts` + `api-lifecycle.contract.test.ts` + remote smoke |
| FR-002 | PASS | `host-api-client.unit.test.ts` + `api-lifecycle.contract.test.ts` + non-default `apiBasePath` smoke |
| FR-003 | PASS | `WorkspaceBindings.ts` + `workspace-bindings.unit.test.ts` |
| FR-004 | PASS | `api-status-capabilities.contract.test.ts` + smoke `api status` |
| FR-005 | PASS | `workspaceResolver.ts` + `workspace-resolution.contract.test.ts` |
| FR-006 | PASS | `api-status-capabilities.contract.test.ts` + smoke `bindingSource=live_ui_context` |
| FR-007 | PASS | `workspace-resolution.contract.test.ts` + `api-binding-scope.contract.test.ts` |
| FR-008 | PASS | `workspace-resolution.contract.test.ts` |
| FR-009 | PASS | `api-status-capabilities.contract.test.ts` |
| FR-010 | PASS | `api-status-capabilities.contract.test.ts` + smoke `workspace.resolved/currentWorkspaceId/currentDbPath` |
| FR-011 | PASS | `Errors.ts` + `api-binding-scope.contract.test.ts` + `workspace-resolution.contract.test.ts` |
| FR-012 | PASS | `docs/ssot/agent-remnote/http-api-contract.md` |
| FR-013 | PASS | implementation + full suite regression |
| FR-014 | PASS | `http-api-contract.md` + `api-status-capabilities.contract.test.ts` |
| FR-015 | PASS | `ApiDaemonFiles.ts` + smoke `api status` state payload |
| FR-016 | PASS | README / README.zh-CN / SSoT updates |

### 非功能需求（NFR）

| ID | 当前状态 | 证据 |
| --- | --- | --- |
| NFR-001 | PASS | live binding smoke + `workspace-resolution.contract.test.ts` |
| NFR-002 | PASS | `api-status-capabilities.contract.test.ts` |
| NFR-003 | PASS | `workspace-resolution.contract.test.ts` + `api-binding-scope.contract.test.ts` |
| NFR-004 | PASS | full `npm test --workspace agent-remnote` |
| NFR-005 | PASS | contract tests all keep stdout/stderr discipline in English |

### 成功标准（SC）

| ID | 当前状态 | 证据 |
| --- | --- | --- |
| SC-001 | PASS | live-ui-context smoke + daemon-down smoke (`resolutionSource=binding`) |
| SC-002 | PASS | non-default `apiBasePath` smoke |
| SC-003 | PASS | `workspace-resolution.contract.test.ts` |
| SC-004 | PASS | `api-status-capabilities.contract.test.ts` |
| SC-005 | PASS | remote smoke only used `apiBaseUrl` |
