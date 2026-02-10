# Acceptance Report: 009-effect-native-upgrade（上帝视角验收）

**Date**: 2026-01-26  
**Spec**: `specs/009-effect-native-upgrade/spec.md`  
**Scope**: 覆盖 `spec.md` 内所有编码点：FR / NFR / SC  

## 总结裁决

- **整体结论**：通过（PASS）。核心链路已完成 Effect Native 收口，静态门禁 + contract/unit/integration-ish tests 形成可执行基线。
- **补齐项**：已补齐 `NFR-004` 的量化性能基线（非 hard gate；用于后续对比“可观测性能退化”）。
- **本次复验**：在后续路线（010/011/013）合入后复核本验收引用与关键契约，未发现漂移。

## 证据索引（高信号）

- CLI 对外契约（`--json` 单行 envelope + stderr 为空）：`docs/ssot/agent-remnote/cli-contract.md`
- write-first 契约（`nextActions`/错误码/`--ids` 纯 ids）：`docs/ssot/agent-remnote/tools-write.md`、`packages/agent-remnote/tests/contract/write-first.contract.test.ts`
- statusLine file mode 契约：`specs/009-effect-native-upgrade/contracts/status-line-file.md`
- 静态门禁（分层/原语/内核可移植）：`packages/agent-remnote/tests/gates/*`
- runtime Actor（ws-bridge / supervisor / statusLine）：`packages/agent-remnote/src/runtime/**`

## 覆盖矩阵（FR/NFR/SC）

| Code | 结论 | 证据（实现/测试/文档） | 漂移/缺口 |
|---|---|---|---|
| FR-001 | PASS | `README.md`、`README.zh-CN.md`、`docs/ssot/agent-remnote/**`、`packages/agent-remnote/tests/contract/**` | 无（forward-only 以 contract tests 作为新基线证据） |
| FR-002 | PASS | `packages/agent-remnote/tests/gates/primitive-usage.contract.test.ts`、`packages/agent-remnote/src/services/**`、`packages/agent-remnote/src/runtime/**` | allowlist 已收紧为 0（commands/runtime 不再直接使用平台原语） |
| FR-003 | PASS | `packages/agent-remnote/src/runtime/status-line/StatusLineController.ts`、`packages/agent-remnote/tests/unit/status-line-controller.unit.test.ts` | 无 |
| FR-004 | PASS | `specs/009-effect-native-upgrade/contracts/status-line-file.md`、`packages/agent-remnote/src/services/StatusLineFile.ts`、`packages/agent-remnote/src/services/Tmux.ts`、`packages/agent-remnote/tests/contract/status-line-file.contract.test.ts` | tmux 配置需人工应用（契约已给出示例） |
| FR-005 | PASS | `packages/agent-remnote/src/runtime/status-line/updateStatusLine.ts`、`packages/agent-remnote/tests/contract/status-line-file.contract.test.ts`、`packages/agent-remnote/tests/contract/daemon-status-line-queue.contract.test.ts` | 无 |
| FR-006 | PASS | `packages/agent-remnote/src/services/Config.ts`、`packages/agent-remnote/src/services/CliConfigProvider.ts`、`packages/agent-remnote/tests/unit/status-line-controller.unit.test.ts` | 无 |
| FR-007 | PASS（SHOULD） | daemon 侧事件驱动：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`；CLI fallback：`packages/agent-remnote/src/commands/_enqueue.ts` | 未提供“显式 daemon refresh RPC”，但已满足 SHOULD 的统一刷新意图（daemon 优先、CLI 兜底） |
| FR-008 | PASS | `README.md`（Safety boundaries）、写入命令均走队列：`packages/agent-remnote/src/commands/write/**`、`packages/agent-remnote/src/commands/_enqueue.ts` | 无（红线为全局约束，本次无回退迹象） |
| FR-009 | PASS | `packages/agent-remnote/src/services/CliConfigProvider.ts`、`packages/agent-remnote/src/services/Config.ts`、`packages/agent-remnote/tests/gates/primitive-usage.contract.test.ts`（禁止 `process.env.* =`） | 无 |
| FR-010 | PASS | `packages/agent-remnote/src/kernel/**`、`specs/009-effect-native-upgrade/contracts/portable-kernel-and-actors.md`、`packages/agent-remnote/tests/gates/kernel-portability.contract.test.ts` | 无 |
| NFR-001 | PASS | `specs/009-effect-native-upgrade/contracts/status-line-file.md`、`packages/agent-remnote/src/services/StatusLineFile.ts`、`packages/agent-remnote/src/services/Tmux.ts` | tmux “读文件”模式需用户启用（契约给出） |
| NFR-002 | PASS | `packages/agent-remnote/tests/unit/ws-client.unit.test.ts`、`packages/agent-remnote/tests/unit/status-line-controller.unit.test.ts`（TestClock） | 无 |
| NFR-003 | PASS | `packages/agent-remnote/src/services/Errors.ts`、`docs/ssot/agent-remnote/cli-contract.md`、`packages/agent-remnote/src/commands/config/print.ts`、`packages/agent-remnote/tests/contract/**` | 无 |
| NFR-004 | PASS | 基准脚本：`packages/agent-remnote/scripts/bench-nfr-004.ts`；基线结果：`specs/009-effect-native-upgrade/performance-baseline.md`、`specs/009-effect-native-upgrade/performance-baseline.json`；可选硬门禁：`npm run gate:nfr-004 --workspace agent-remnote` | 无（默认不 gate；需要时可用阈值对比发现回归） |
| NFR-005 | PASS | `docs/ssot/agent-remnote/tools-write.md`、`packages/agent-remnote/src/commands/_enqueue.ts`、`packages/agent-remnote/tests/contract/write-first.contract.test.ts`、`packages/agent-remnote/tests/contract/ids-output.contract.test.ts` | 无 |
| NFR-006 | PASS | `packages/agent-remnote/tests/unit/**`、`packages/agent-remnote/tests/integration/**`、`packages/agent-remnote/tests/gates/**`、`specs/009-effect-native-upgrade/contracts/testing-strategy.md` | 无 |
| SC-001 | PASS | `packages/agent-remnote/tests/contract/**`（全量通过作为基线） | 无 |
| SC-002 | PASS | `packages/agent-remnote/src/runtime/status-line/StatusLineController.ts`、`packages/agent-remnote/tests/unit/status-line-controller.unit.test.ts` | 无 |
| SC-003 | PASS | `packages/agent-remnote/tests/contract/status-line-file.contract.test.ts` / `daemon-status-line-queue.contract.test.ts` | 无 |
| SC-004 | PASS | `packages/agent-remnote/tests/gates/primitive-usage.contract.test.ts`（whitelist 已收紧为 0） | 无 |
| SC-005 | PASS | `packages/agent-remnote/tests/gates/kernel-portability.contract.test.ts` | 无 |

## 漂移/缺口矩阵（聚焦问题）

- 无（所有编码点均有直接证据或可自动化门禁支撑）

## Next Actions（按优先级）

- 无（本轮已补齐：primitive allowlist 收紧为 0；NFR-004 提供可选硬门禁脚本与阈值策略，默认关闭）
