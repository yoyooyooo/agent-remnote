# Acceptance Report: 011-write-command-unification（上帝视角验收）

**Date**: 2026-01-26  
**Spec**: `specs/011-write-command-unification/spec.md`  
**Scope**: 覆盖 `spec.md` 内所有编码点：FR / NFR / SC  

## 总结裁决

- **整体结论**：通过（PASS）。写入命令面已实现 write-first + raw 入队收口，并新增 `--wait` 以单次调用闭环确认 txn 终态；失败可诊断与 `nextActions[]` 契约已由 contract tests 固化为新基线。

## 覆盖矩阵（FR/NFR/SC）

| Code | 结论 | 证据（实现/测试/文档） | 漂移/缺口 |
|---|---|---|---|
| FR-001 | PASS | `packages/agent-remnote/src/commands/write/{md.ts,bullet.ts}`、`packages/agent-remnote/src/commands/replace/text.ts`（写入命令内部完成校验与诊断） | 无 |
| FR-002 | PASS | `docs/ssot/agent-remnote/tools-write.md`、`README.md`、`README.zh-CN.md`（场景→命令映射） | 无 |
| FR-003 | PASS | `packages/agent-remnote/src/commands/write/ops.ts` + wiring：`packages/agent-remnote/src/commands/write/index.ts`；并已移除旧入口 wiring：`packages/agent-remnote/src/commands/index.ts`、`packages/agent-remnote/src/commands/queue/index.ts` | forward-only breaking（已同步 README/SSoT） |
| FR-004 | PASS | output contract：`docs/ssot/agent-remnote/cli-contract.md`、`docs/ssot/agent-remnote/tools-write.md`；典型失败 contract：`packages/agent-remnote/tests/contract/write-failures.contract.test.ts` | 无 |
| FR-005 | PASS | `--json` / `--ids` purity：`docs/ssot/agent-remnote/cli-contract.md`；contract：`packages/agent-remnote/tests/contract/write-ops.contract.test.ts`、`packages/agent-remnote/tests/contract/write-failures.contract.test.ts` | 无 |
| FR-006 | PASS（SHOULD） | wait 核心：`packages/agent-remnote/src/commands/_waitTxn.ts`；复用点：`packages/agent-remnote/src/commands/queue/wait.ts`、`packages/agent-remnote/src/commands/write/{md.ts,bullet.ts,ops.ts}`、`packages/agent-remnote/src/commands/daily/write.ts`、`packages/agent-remnote/src/commands/replace/{block.ts,text.ts}`；contract：`packages/agent-remnote/tests/contract/write-wait.contract.test.ts` | 无 |
| NFR-001 | PASS | `hint/nextActions` 面向下一步行动：`packages/agent-remnote/tests/contract/write-failures.contract.test.ts`、`docs/ssot/agent-remnote/tools-write.md` | 无 |
| NFR-002 | PASS | forward-only：删除旧入口（不保留 alias）；文档同步：`README.md`、`README.zh-CN.md`、`README.local.md`、`docs/ssot/agent-remnote/tools-write.md` | 无 |
| SC-001 | PASS | 高频写入路径（md/bullet/replace/ops）contract 基线：`packages/agent-remnote/tests/contract/write-*.contract.test.ts` | 无 |
| SC-002 | PASS | 唯一 raw 入队入口：`agent-remnote write advanced ops`（wiring 证据同 FR-003） | 无 |
| SC-003 | PASS | 典型失败诊断 contract：`packages/agent-remnote/tests/contract/write-failures.contract.test.ts` | 无 |
| SC-004 | PASS | `--wait` 不诱导重复写入：成功/超时的稳定错误码 + `nextActions[]`：`packages/agent-remnote/tests/contract/write-wait.contract.test.ts` | 无 |

## 漂移/缺口矩阵（聚焦问题）

- 无（所有编码点均有直接证据或由 contract tests 锁死）

## Next Actions（按优先级）

1) **纳入 012：`write plan`**
   - 012 落地后将补齐“多步依赖写入”的单入口体验，并把 `idempotency_key` / `id_map` 的闭环纳入 write-first 语义（见 `specs/012-batch-write-plan/spec.md`）。
