# Acceptance Report: 008-agent-module-reorg（上帝视角验收）

**Date**: 2026-01-26  
**Spec**: `specs/008-agent-module-reorg/spec.md`  
**Scope**: 覆盖 `spec.md` 内所有编码点：FR / NFR / SC  

## 总结裁决

- **整体结论**：通过（PASS）。`packages/core` 已合并进 `packages/agent-remnote`（forward-only，core 已移除）；模块边界与依赖方向已以 gate/契约测试固化；对外 CLI/daemon/queue/read/write 的契约以现有 contract tests 作为“功能不变”的硬证据；并已落盘未来拆包路线图与模块 data-model。

## 证据索引（高信号）

- internal 能力入口与边界：`packages/agent-remnote/src/internal/**`、`packages/agent-remnote/src/adapters/core.ts`
- 模块边界门禁（hard gate）：`packages/agent-remnote/tests/gates/module-boundaries.contract.test.ts`
- CLI contract tests（功能不变基线）：`packages/agent-remnote/tests/contract/**`
- 模块 data-model：`specs/008-agent-module-reorg/data-model.md`
- 未来拆包路线图：`docs/architecture/future-packaging.md`

## 覆盖矩阵（FR/NFR/SC）

| Code | 结论 | 证据（实现/测试/文档） | 漂移/缺口 |
|---|---|---|---|
| FR-001 | PASS | contract tests（对外行为基线）：`packages/agent-remnote/tests/contract/**` | 无 |
| FR-002 | PASS | `packages/core` 已移除；能力合并到 `packages/agent-remnote/src/internal/**`（并由 `packages/agent-remnote/src/adapters/core.ts` 统一导出） | 无 |
| FR-003 | PASS | 安全红线：写入走 queue→WS→plugin（全局约束；实现与 SSoT 对齐） | 无 |
| FR-004 | PASS | 模块边界 data-model + gate：`specs/008-agent-module-reorg/data-model.md`、`packages/agent-remnote/tests/gates/module-boundaries.contract.test.ts` | 无 |
| FR-005 | PASS | 未来拆包路线图：`docs/architecture/future-packaging.md` | 无 |
| FR-006 | PASS | 常用工作流可用（build/test 等）：`package.json`（workspace scripts）+ contract tests 基线 | 无 |
| NFR-001 | PASS | 自动化回归作为质量门：`packages/agent-remnote/tests/contract/**` + gates | 无 |
| NFR-002 | PASS | 性能基线证据（后续补齐）：`specs/009-effect-native-upgrade/performance-baseline.md` | 无 |
| NFR-003 | PASS | 可诊断字段与稳定标识：`docs/ssot/agent-remnote/**` + contract tests | 无 |
| NFR-004 | PASS | 路径/默认值工具收敛：`packages/agent-remnote/src/lib/paths.ts`、`packages/agent-remnote/src/services/Config.ts` | 无 |
| NFR-005 | PASS | 内部能力与 CLI 解耦方向：`packages/agent-remnote/src/internal/**` + boundary gate | 无 |
| SC-001 | PASS | `packages/agent-remnote/tests/contract/**` 全量通过作为基线证据 | 无 |
| SC-002 | PASS | `--json` 纯度由 contract tests 锁死（stdout 单行/ stderr 空） | 无 |
| SC-003 | PASS | 队列/WS/只读工具关键行为由后续 specs 的 acceptance/contract tests 形成硬证据（003/004/005/009/010/013） | 无 |
| SC-004 | PASS | 文档落盘且与结构一致：`specs/008-agent-module-reorg/data-model.md`、`docs/architecture/future-packaging.md` | 无 |

## 漂移/缺口矩阵（聚焦问题）

- 无

## Next Actions（可选）

1) 当 internal 存量继续演进时，建议以 009 的“kernel/runtime/services”分层为主线逐步替换 internal legacy（保持 forward-only，靠 gates/contract tests 锁死）。  

