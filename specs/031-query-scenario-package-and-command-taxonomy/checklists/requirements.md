# 规格质量检查表：查询 / Scenario / 命令 taxonomy 归一化

**目的**: 在进入实现规划之前，验证 031 规格完整性  
**创建时间**: 2026-03-22  
**对应规格**: [spec.md](../spec.md)

## Content Quality

- [x] 核心规格中没有泄漏实现细节
- [x] 聚焦用户价值和业务需求
- [x] 本特性被明确约束为一个大的归一化需求
- [x] 必填章节已经完成

## Requirement Completeness

- [x] Scope 已清晰边界化
- [x] Query / Scenario / Taxonomy 术语明确
- [x] `master` 作为默认主线已明确
- [x] Builtin preset 与未来 provider 的范围界限明确
- [x] “不得形成第二套命令体系”的目标已显式写出
- [x] `powerup.todo.*` 作为 current canonical todo write surface 已与当前 authoritative SSoT 对齐
- [x] `scenario` namespace 的 public promotion preconditions 已显式写出
- [x] `todo list -> query preset` 的迁移方向、兼容入口与切换条件已显式写出

## Feature Readiness

- [x] selector、scenario、builtin preset、taxonomy 均有用户故事
- [x] planning 工件中已识别风险
- [x] 实现阶段要扩展的 contracts 已列出
- [x] implement gate 已覆盖 authoritative inventory / CLI contract / docs drift 前置项
- [x] quickstart 已覆盖 promotion preconditions 与 alias migration gate

## Notes

- 031 有意停在 builtin preset catalog 与 provider reservation。
- 未来 plugin / provider 机制应扩展 provider interface，而不是改写 `ScenarioPackage` 语义。
- `scenario` 子树在 promotion preconditions 完成前只作为 031 feature-local planned namespace 存在。
