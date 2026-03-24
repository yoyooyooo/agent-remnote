# 契约：ScenarioExecutionPlanV1

日期：2026-03-22

## 目的

定义 `ScenarioPackage` 到执行面的统一中间态。

## 核心定位

- `ScenarioPackage` 是对外工件
- `ScenarioExecutionPlanV1` 是内部执行中间态
- `WritePlanV1` 继续只负责写动作编译

推荐关系：

`ScenarioPackageV1 -> ScenarioExecutionPlanV1 -> apply actions -> WritePlanV1 -> ops`

## 必需组成

- `version`
- `source_package`
- `phase`
- `vars_bound`
- `selector_plan`
- `selection_sets`
- `transform_plan`
- `action_plan`
- `scheduling?`
- `compiled_execution?`
- `diagnostics?`

补充约束：

- `selector_plan` 只表达 normalized selector requests，不直接表达宿主求值结果
- `selection_sets` 必须是按 node id keyed、可序列化、可重放、无副作用的结果集 registry
- `phase` 用于区分 planned / resolved / compiled 等阶段
- `transform_plan` 只表达纯数据变换
- `action_plan` 只表达动作意图与 targeting
- `scheduling` 只表达 advisory hints，不直接替代 runtime scheduler
- `compiled_execution` 只在动作层已经完成 host-authoritative lowering 后出现
- `planned` 阶段必须满足：
  - `selection_sets` 是空 registry
  - `compiled_execution` 不存在
- `resolved` 阶段必须满足：
  - `selection_sets` 可存在
  - `compiled_execution` 不存在
- `compiled` 阶段必须满足：
  - `compiled_execution` 存在
  - 所有 `node_output` 引用已经完成 lowering 所需的 host binding

## 关键边界

### `selection_sets`

职责：

- 以 node id registry 表达“每个 selector 节点选中了什么”
- 表达来源与 lineage
- 作为 transform 与 action 的输入

不负责：

- 执行副作用
- 写入策略
- 动作语义
- 代替宿主机做 ref / metadata / scope 解析

### `action_plan`

职责：

- 表达“对结果集做什么”
- 可编译到 business command 语义或 `apply kind=actions`
- `input` 只能消费：
  - vars
  - declared node output slot
  - literal

补充约束：

- `action_plan` 应保留业务语义 command id，而不是要求 caller 直接书写 performance-oriented bulk family
- host runtime 可以在 lowering 阶段把连续、同质、可证明等价的 action coalesce 成 internal bulk family
- internal bulk family 属于 lowering/runtime 事实，不是 `ScenarioPackage` authoring 的默认主语

不负责：

- 再解释 selector
- 再解释宿主 metadata
- 再决定 workspace / query scope

### `scheduling`

职责：

- 表达批处理、合并、并行、顺序、dispatch mode 方面的声明式 hints
- 把“可优化机会”保留在可校验 contract 中

不负责：

- 指定 batch size
- 指定 lease / retry / timeout policy
- 指定 active worker 选择
- 指定具体 lock key 推导算法

### `compiled_execution`

职责：

- 表达最终编译出口
- 覆盖 `business_command` 与 `apply_actions` 两条 canonical 路线

最小 union shape：

- `business_command`
  - `kind`
  - `command_id`
  - `input`
- `apply_actions`
  - `kind`
  - `envelope`

不负责：

- 让客户端直接提交 `ScenarioExecutionPlanV1`
- 暴露 raw ops 作为公开 scenario 编译出口
- 要求 caller 主动选择 internal bulk surface

## Shared / Runtime Boundary

shared contract 可承载：

- `ScenarioExecutionPlanV1` 的 schema 与 types
- 结构化引用节点校验
- 纯 normalize / validate / preview 逻辑
- advisory scheduling hint 的 schema 校验
- `phase=planned` 的 skeleton 构造与校验

shared contract 不得构造：

- materialized `SelectionSet`
- `phase=resolved` 的 host facts
- `compiled_execution`

host runtime 必须负责：

- vars 与宿主事实绑定后的最终 execution request
- selector 执行与 `SelectionSet` materialization
- 依赖 metadata 的 action lowering
- compile 到 business command 或 `apply kind=actions`
- queue / WS / plugin 侧的最终调度策略

补充说明：

- 031 采用单一 phased IR，而不是同时冻结 `Plan` / `ResolvedPlan` 双类型
- `planned` 阶段不含 materialized `SelectionSet`
- `resolved` 阶段可包含 `selection_sets`
- `compiled` 阶段可包含 `compiled_execution`
- 该模型可以在 host runtime 中逐步充实，不限定为纯 pre-execution snapshot
- Host API 不接受客户端直接提交 `ScenarioExecutionPlanV1`
- shared tooling 若需要 explain / preview，只能停在 `planned` skeleton 或 host-independent outline

## 宿主机裁决点

以下语义必须在宿主机 authoritative runtime 执行：

- powerup metadata 解析
- `--powerup` 解析
- query scope 展开
- tag / powerup / slot / reference / ids predicate 求值
- workspace binding 与库选择
- `selection_sets` materialization
- 依赖宿主 metadata 的 action 编译
- scheduling hint 到实际 queue / WS / plugin 调度策略的最终落地
- `compiled_execution` 的最终 shape 选择

## 非目标

- 循环
- 任意条件分支
- 任意代码节点
- 任意外部副作用节点
