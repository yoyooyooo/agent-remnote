# 契约：Selector 与 Action 编译

日期：2026-03-22

## 目的

定义 `selector -> SelectionSet -> action -> apply` 的编译关系。

## 必需阶段

1. package normalization
2. selector / transform / action planning
3. selector execution
4. `SelectionSet` 与 transform resolution
5. action lowering
6. runtime scheduling hint lowering

### 1. package normalization

- 输入：`ScenarioPackageV1`
- 输出：canonical package
- 负责：
  - 字段别名规范化
  - `depends_on` / `entry` / `outputs` 基本校验
  - output slot registry 建立

### 2. selector / transform / action planning

- 输出：`ScenarioExecutionPlanV1.phase=planned`
- 负责：
  - selector request planning
  - transform algebra planning
  - action intent planning
- 该阶段只能产出 host-independent planning canonicalization

### 3. selector execution

- 输出：materialized `SelectionSet`
- 负责：
  - selector 求值
  - host facts 绑定
  - lineage / truncation / diagnostics 记录

### 4. `SelectionSet` 与 transform resolution

- 输出：`ScenarioExecutionPlanV1.phase=resolved`
- 负责：
  - host-independent transform 执行
  - `StructuredReferenceNode` 到 concrete selection / projection 的解析
- 不得在这一阶段做 action lowering

### 5. action lowering

- 输出：`ScenarioExecutionPlanV1.phase=compiled`
- lowering 目标只允许：
  - `business_command`
  - `apply_actions`
- `business_command` lowering 必须复用现有 canonical command id 与现有 input contract
- `apply_actions` lowering 必须产出标准 `apply` envelope
- action lowering 可以在 host runtime 中静默执行 scalar-to-bulk coalescing
- 该 coalescing 只允许作用于连续、同质、无 alias 依赖、语义等价的 action
- internal bulk family 可以作为 lowering 中间形态存在，但不应成为 caller 默认 authoring surface

### 6. runtime scheduling hint lowering

- 输入：compiled execution + scheduling hints
- 输出：queue / WS / plugin runtime policy
- 该阶段是 host-authoritative runtime 责任

## Constraints

- 不把 selector 直接塞进 `WritePlanV1`
- 多步依赖动作允许编译到 `apply kind=actions`
- 单步场景优先编译到现有业务命令语义
- 调度 hints 只表达优化机会，不表达 runtime guarantee
- 场景公开编译出口不得降级为 raw ops
- 不要求 caller 为性能优化显式改写 action surface
- shared contract 只能覆盖 package normalization 与 `phase=planned` 的 planning canonicalization
- 任何 `SelectionSet` materialization、action lowering、`compiled_execution` 构造都必须留在 host runtime
- `StructuredReferenceNode.node_output` 只能引用已声明 output slot
- `action` lowering 不得新增第二套 command taxonomy，不得绕开现有 Wave 1 runtime spine
