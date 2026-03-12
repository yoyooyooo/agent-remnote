# Acceptance: 021-host-api-remote-surface-and-workspace-binding

Date: 2026-03-12  
Spec: `specs/021-host-api-remote-surface-and-workspace-binding/spec.md`

## 验收状态

- 当前状态：PENDING
- 本次仅完成 spec / data-model / plan / tasks / quickstart 文档产物
- 代码实现、自动化测试、本机 smoke 证据尚未回填

## 待验收覆盖矩阵

### 功能需求（FR）

| ID | 目标结论 | 计划证据（实现/测试） | 当前状态 |
| --- | --- | --- | --- |
| FR-001 | Host API 成为通用远程 surface | `packages/agent-remnote/src/services/HostApiClient.ts`、remote contract tests | PENDING |
| FR-002 | `apiBasePath` 全链路贯通 | `packages/agent-remnote/src/runtime/http-api/runHttpApiRuntime.ts`、`packages/agent-remnote/src/services/HostApiClient.ts`、`api status` / `stack status` contract tests | PENDING |
| FR-003 | Store DB 持久化 workspace binding | Store migration + `WorkspaceBindings` service + unit tests | PENDING |
| FR-004 | 暴露 `currentWorkspaceId` | `status` use case + API contract tests | PENDING |
| FR-005 | DB 解析优先级统一 | `workspaceResolver` + contract tests | PENDING |
| FR-006 | live `uiContext.kbId` 自动建 binding | 本机 smoke + integration/contract tests | PENDING |
| FR-007 | 多候选无强信号时返回 `WORKSPACE_UNRESOLVED` | `workspace-resolution.contract.test.ts` | PENDING |
| FR-008 | 目录扫描仅承担候选枚举角色 | resolver tests + code review | PENDING |
| FR-009 | `status` 暴露 capability 状态 | `api-status-capabilities.contract.test.ts` | PENDING |
| FR-010 | `status` 暴露 workspace 解析状态 | `api-status-capabilities.contract.test.ts` + smoke | PENDING |
| FR-011 | 错误码能区分 workspace/db/plugin/write/ui session 边界 | `Errors.ts` + contract tests | PENDING |
| FR-012 | remote-capable 命令矩阵文档化 | `docs/ssot/agent-remnote/http-api-contract.md`、README | PENDING |
| FR-013 | DB read 支持显式 `workspaceId` | endpoint tests + quickstart | PENDING |
| FR-014 | UI session 语义明确标注 | contract + 文档 | PENDING |
| FR-015 | `api.state.json` 使用通用远程语义 | `ApiDaemonFiles` + status smoke | PENDING |
| FR-016 | 文档同步更新 | README / README.zh-CN / runbook / SSoT | PENDING |

### 非功能需求（NFR）

| ID | 目标结论 | 计划证据 | 当前状态 |
| --- | --- | --- | --- |
| NFR-001 | 零配置稳定选库 | 多 KB 本机 smoke | PENDING |
| NFR-002 | 解析来源可解释 | `status` 返回 `source` / `candidateWorkspaces` | PENDING |
| NFR-003 | 多候选时 fail-fast | unresolved contract tests | PENDING |
| NFR-004 | 不破坏 019 主路径 | 现有 Host API / stack 回归测试 | PENDING |
| NFR-005 | 用户可见文本保持英文 | 错误输出检查 + contract tests | PENDING |

### 成功标准（SC）

| ID | 目标结论 | 计划证据 | 当前状态 |
| --- | --- | --- | --- |
| SC-001 | 打开目标 KB 一次后自动建立 binding，后续 DB read 不漂移 | 本机 smoke | PENDING |
| SC-002 | 非默认 `apiBasePath` 可正常工作 | contract tests + manual curl | PENDING |
| SC-003 | 多候选无强信号时返回 `WORKSPACE_UNRESOLVED`，不写长期默认值 | resolver contract tests | PENDING |
| SC-004 | 远程调用方可仅通过 `status` 判断四类 capability | `api-status-capabilities.contract.test.ts` | PENDING |
| SC-005 | remote mode 只依赖 `apiBaseUrl` | remote/local caller smoke + contract tests | PENDING |

## 计划验证命令

```bash
npm run typecheck --workspace agent-remnote
npm test --workspace agent-remnote
```

若包含本机 smoke，补充执行：

```bash
agent-remnote stack stop
agent-remnote stack ensure --wait-worker --worker-timeout-ms 15000
agent-remnote api status --json
curl http://127.0.0.1:3000/v1/status
```

## 回填要求

- 实现完成后，将本文件中的 `PENDING` 逐项替换为 `PASS` / `PARTIAL` / `FAIL`
- 对每一项填写对应代码文件、测试文件、命令输出摘要
- 若存在暂缓项，必须写明阻塞原因和 next actions
