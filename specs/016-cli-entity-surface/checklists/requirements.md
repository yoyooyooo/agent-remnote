# Requirements Checklist: 016-cli-entity-surface

Spec: `specs/016-cli-entity-surface/spec.md`

## Functional (FR)

- [x] FR-001：一级入口以 `read/write` 为主，所有写入副作用归属 `write`
- [x] FR-002：Portal 高层写入命令严格对应 SDK（createPortal + moveRems + addToPortal）
- [x] FR-003：`write advanced ops` 下沉到 advanced/debug；文档与 skill 明确非默认推荐
- [x] FR-004：新增命令继承 011 的输出/诊断契约（`--json` 纯净、稳定错误码、`--wait` 闭环、nextActions 英文）
- [x] FR-005：Tag/Table 高层语义入口覆盖常见写入，不需要回退到 `write advanced ops`
- [x] FR-006：双视角入口（Tag）有 canonical 推荐路径；非 canonical 为薄壳且参数/输出一致
- [x] FR-007：forward-only：旧入口不长期保留造成歧义（短期 alias 必须不可误导 Agent）

## Non-Functional (NFR)

- [x] NFR-001：命令选择低熵；多入口必须标注 canonical 且不引入新的默认分叉
- [x] NFR-002：命名可组合且一致（实体+动作），可溯源到底层 op 类型（便于排障）

## Success Criteria (SC)

- [x] SC-001：Portal/Rem/Tag/Table 常见写入无需 `write advanced ops`
- [x] SC-002：读写边界清晰；help/文档/skill 不漂移
- [x] SC-003：至少具备 portal create + rem text/delete + table create + tag 双视角一致性的 contract tests
