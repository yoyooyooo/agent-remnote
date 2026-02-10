# Acceptance Checklist (Template): 016-cli-entity-surface

**Date**: 2026-01-26  
**Spec**: `specs/016-cli-entity-surface/spec.md`  
**Goal**: Agent-safe CLI tree（read/write 边界清晰 + 实体子命令 + ops 降级为 advanced）

> 本文件是“验收模板/清单”，实现完成后填写证据并给出 PASS/FAIL。

## Pre-flight

- [x] `--json` 输出纯净：stdout 单行 envelope；stderr 为空（见 `docs/ssot/agent-remnote/cli-contract.md`；Evidence: `packages/agent-remnote/tests/contract/*.contract.test.ts`）
- [x] 全局参数位置规则不变：global flags 必须出现在第一个 subcommand 之前（Evidence: `packages/agent-remnote/tests/contract/invalid-options.contract.test.ts`）
- [x] CLI 用户可见输出/错误信息为英文（stderr / `error.message` / `hint` / `nextActions`；Evidence: `docs/ssot/agent-remnote/cli-contract.md` + contract tests）

## Coverage Matrix (FR/NFR/SC)

| Code | Result | Evidence (files/tests/docs) | Notes |
|---|---:|---|---|
| FR-001 | PASS | `packages/agent-remnote/src/commands/index.ts`, `packages/agent-remnote/tests/contract/help.contract.test.ts` |  |
| FR-002 | PASS | `packages/agent-remnote/src/commands/write/portal/create.ts`, `packages/plugin/src/bridge/ops/handlers/portalOps.ts`, `packages/agent-remnote/tests/contract/write-portal-create.contract.test.ts` |  |
| FR-003 | PASS | `packages/agent-remnote/src/commands/write/advanced/index.ts`, `docs/ssot/agent-remnote/tools-write.md` |  |
| FR-004 | PASS | `docs/ssot/agent-remnote/cli-contract.md`, `packages/agent-remnote/tests/contract/write-first.contract.test.ts` |  |
| FR-005 | PASS | `packages/agent-remnote/src/commands/write/tag/index.ts`, `packages/agent-remnote/src/commands/write/table/create.ts`, `packages/agent-remnote/tests/contract/write-table-create.contract.test.ts` |  |
| FR-006 | PASS | `docs/ssot/agent-remnote/tools-write.md`, `packages/agent-remnote/tests/contract/write-tag-rem.contract.test.ts` |  |
| FR-007 | PASS | `packages/agent-remnote/src/commands/index.ts`, `packages/agent-remnote/tests/contract/help.contract.test.ts` | forward-only (breaking OK) |
| NFR-001 | PASS | `docs/ssot/agent-remnote/tools-write.md`, `specs/016-cli-entity-surface/spec.md` | canonical path documented |
| NFR-002 | PASS | `packages/agent-remnote/src/kernel/op-catalog/catalog.ts`, `packages/agent-remnote/src/commands/ops/schema.ts` | traceable to op types |
| SC-001 | PASS | `docs/ssot/agent-remnote/tools-write.md`, `specs/016-cli-entity-surface/spec.md` |  |
| SC-002 | PASS | `README.md`, `README.zh-CN.md`, `packages/agent-remnote/tests/contract/help.contract.test.ts` |  |
| SC-003 | PASS | `packages/agent-remnote/tests/contract/write-portal-create.contract.test.ts`, `packages/agent-remnote/tests/contract/write-table-create.contract.test.ts`, `packages/agent-remnote/tests/contract/write-tag-rem.contract.test.ts` |  |

## Manual Smoke (optional; covered by automated tests)

- [x] `agent-remnote --json ops list`（discoverability；Covered: `packages/agent-remnote/tests/contract/help.contract.test.ts`）
- [x] `agent-remnote --json write portal create ... --wait`（Portal；Covered: `packages/agent-remnote/tests/contract/write-portal-create.contract.test.ts`）
- [x] `agent-remnote --json write table create ... --wait`（Table；Covered: `packages/agent-remnote/tests/contract/write-table-create.contract.test.ts`）
- [x] `agent-remnote --json write tag add/remove ... --wait`（Tag；Covered: `packages/agent-remnote/tests/contract/write-tag-rem.contract.test.ts`）
- [x] `agent-remnote --json write rem tag add/remove ... --wait`（Tag dual surface；Covered: `packages/agent-remnote/tests/contract/write-tag-rem.contract.test.ts`）
