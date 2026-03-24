# 快速开始：031 查询 / Scenario / 命令 taxonomy 归一化

日期：2026-03-22

## 目标

给 031 后续实现阶段提供最小验收路径。

重点验证：

- selector kernel contract 已冻结
- `ScenarioPackage` schema 已冻结
- builtin preset catalog 边界已冻结
- command taxonomy 已冻结
- local / remote parity 约束仍保持单真相

## A. 设计验收

1. 检查 031 spec 工件是否齐全。
2. 检查 Query / Scenario / Command taxonomy 是否不存在互相打架的术语。
3. 检查 `master` 作为默认主线的表述是否一致。

## B. 未来实现验收占位

后续实现阶段至少要补这些门禁：

1. selector AST / DSL drift
2. scenario package schema validation
3. builtin preset catalog drift
4. command help / taxonomy drift
5. authoritative inventory / commandInventory mirror drift
6. CLI contract / README / docs propagation drift
7. `todo list -> query --preset` compatibility alias drift
8. selector local / remote parity
9. `scenario` public promotion precondition check
10. scenario local / remote parity
11. selector/action compilation integration
12. scheduling / shared / failure gates
13. builtin scenario install / user-store resolution drift

## 通过标准

- 031 的 `spec / plan / tasks / research / data-model / contracts / quickstart / checklist` 全部存在
- 术语统一使用：
  - `query`
  - `ScenarioPackage`
  - `SelectionSet`
  - `builtin preset catalog`
  - `master`
- current public owner、alias、promotion preconditions 三类治理信息都已落盘
- `scenario` 子树的 public promotion preconditions 已显式写入 tasks 与 contracts
- user-private scenario store 与 builtin install helper 的边界已显式写入 tasks 与 contracts
- `todo list` 的参数映射、alias 生命周期与 remote parity 切换条件已显式写入 tasks 与 contracts
- implement gate 已覆盖 authoritative inventory、CLI contract、docs drift 三类前置项
- 文档中没有把 remote mode 描述成第二套命令体系
