# Acceptance Report: 006-table-tag-crud（上帝视角验收）

**Date**: 2026-01-26  
**Spec**: `specs/006-table-tag-crud/spec.md`  
**Scope**: 覆盖 `spec.md` 内所有编码点：FR / NFR / SC  

## 总结裁决

- **整体结论**：通过（PASS）。Table/Tag/Rem 语义命令已与插件执行器对齐（snake_case payload），并由 contract tests 锁死 `--json/--ids` 纯度与关键行为（values 数组-only、daily fallback、delete 语义）。
- **已知约束**：Table 的 `values[]` 编译依赖本地只读 RemNote DB（用于 property/option 解析）；当仅提供 `propertyName/optionName(s)` 且无法解析或出现歧义时，按设计 fail-fast 并提示改用 `propertyId/optionId(s)`。

## 覆盖矩阵（FR/NFR/SC）

| Code | 结论 | 证据（实现/测试/文档） | 漂移/缺口 |
|---|---|---|---|
| FR-001 | PASS | 命令面：`packages/agent-remnote/src/commands/write/{tag,rem,table}/**`；Op Catalog：`packages/agent-remnote/src/kernel/op-catalog/catalog.ts` | 无 |
| FR-002 | PASS | Table=Tag/Record=Rem：`specs/006-table-tag-crud/spec.md`；read table：`packages/agent-remnote/src/internal/remdb-tools/readRemTable.ts` | 无 |
| FR-003 | PASS | record CRUD：`packages/agent-remnote/src/commands/write/table/record/{add,update,delete}.ts`；测试：`packages/agent-remnote/tests/contract/write-table-record.contract.test.ts` | 无 |
| FR-004 | PASS | tag add/remove：`packages/agent-remnote/src/commands/write/tag/index.ts`；测试：`packages/agent-remnote/tests/contract/write-tag-rem.contract.test.ts` | 无 |
| FR-005 | PASS | rem delete：`packages/agent-remnote/src/commands/write/rem/delete.ts`；测试：`packages/agent-remnote/tests/contract/write-tag-rem.contract.test.ts` | 无 |
| FR-006 | PASS | 禁止无 parent 创建：`packages/agent-remnote/src/commands/_enqueue.ts`（table_add_row 门禁） | 无 |
| FR-007 | PASS | 默认 `daily:today` + 日记不存在错误：`packages/agent-remnote/src/commands/write/table/record/add.ts`；测试：`packages/agent-remnote/tests/contract/write-table-record.contract.test.ts` | 无 |
| FR-008 | PASS | values 数组-only：`packages/agent-remnote/src/lib/tableValues.ts`；测试：`packages/agent-remnote/tests/contract/write-table-record.contract.test.ts` | 无 |
| FR-009 | PASS | propertyId 优先 + name 歧义 fail-fast：`packages/agent-remnote/src/lib/tableValues.ts` | 无 |
| FR-010 | PASS | select/multi_select 支持 optionName(s)→optionId(s)：`packages/agent-remnote/src/lib/tableValues.ts`；测试：`packages/agent-remnote/tests/contract/write-table-record.contract.test.ts` | 无 |
| FR-011 | PASS | read table 输出 cells：`packages/agent-remnote/src/internal/remdb-tools/readRemTable.ts`、`packages/agent-remnote/src/commands/read/table.ts` | 无 |
| FR-012 | PASS | 安全写入红线：仅入队 + WS + 插件执行（全局约束）；写入入口均走 enqueue：`packages/agent-remnote/src/commands/write/**` | 无 |
| NFR-001 | PASS | `--json` envelope + stderr 为空：contract tests（write/table/tag/rem） | 无 |
| NFR-002 | PASS | 错误码/提示：daily doc missing、values 形态错误、row 不属于 tableTag：命令实现 + contract tests | 无 |
| NFR-003 | PASS | `--idempotency-key` 透传 + write-first：`packages/agent-remnote/src/commands/write/**`（复用 enqueue/统一输出） | 无 |
| NFR-004 | PASS | read table：`limit/offset/hasMore/nextOffset`：`packages/agent-remnote/src/internal/remdb-tools/readRemTable.ts` | 无 |
| NFR-005 | PASS | 成功返回 `txn_id/op_ids/nextActions`（统一 enqueue 语义）+ `--ids` 纯度：`packages/agent-remnote/tests/contract/**` | 无 |
| SC-001 | PASS | record add + read table：命令实现 + contract tests（dry-run 合同；真实环境可闭环） | 无 |
| SC-002 | PASS | record update：`packages/agent-remnote/tests/contract/write-table-record.contract.test.ts` | 无 |
| SC-003 | PASS | record delete：`packages/agent-remnote/tests/contract/write-table-record.contract.test.ts` | 无 |
| SC-004 | PASS | daily fallback + 可修复提示：`packages/agent-remnote/src/commands/write/table/record/add.ts`（错误消息稳定为英文） | 无 |
| SC-005 | PASS | tag remove 永不删除 Rem；delete 仅在 table/rem delete：命令边界 + contract tests | 无 |

## 漂移/缺口矩阵（聚焦问题）

- 无（所有编码点均有直接证据或 contract tests 支撑）

## Next Actions（按优先级）

1) **同步 Agent recipes**
   - 将 table/tag/rem 新命令的最短路径与常见坑（daily fallback、values 数组-only、name 歧义）补进 `$CODEX_HOME/skills/remnote/SKILL.md`（见 `specs/006-table-tag-crud/tasks.md` 的 T023）。
2) **（可选）纳入 write plan action set**
   - 若希望在 `write plan` 里支持 table/tag 操作，建议以 Op Catalog 的 `id_fields` 为裁决点扩展 012 的 action set，避免重复 hardcode。

