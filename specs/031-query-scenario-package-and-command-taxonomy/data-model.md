# 数据模型：031 查询 / Scenario / 命令 taxonomy 归一化

日期：2026-03-22

## 1. QuerySelectorV2

表示 selector kernel 的 canonical outer envelope。

字段：

- `version`
- `root`
- `scope?`
- `shape?`
- `sort?`

说明：

- `version` 在 031 的 canonical selector 输入中固定为 `2`
- `scope` 是顶层一等区段，不混入 leaf predicate
- runtime-ready `scope.kind` 最小集合为：
  - `all`
  - `ids`
  - `descendants`
  - `ancestors`
  - `daily_range`
- `shape` 用于承载 `roots_only` 这类 selector modifier
- `powerup.by` 在 031 内只允许：
  - `id`
  - `rcrt`
- `sort` 是 typed sort block，仍属于 selector envelope
- legacy `{ query: { root } }`、`queryObj`、`{ root }` 只允许停留在 adapter boundary

### QueryExprNodeV2

表示 `root` 内部的布尔表达式树节点。

字段方向：

- `type`
- `nodes?`
- `attribute?`
- `operator?`
- `value?`
- `values?`
- `target?`

必须覆盖：

- tag
- powerup
- slot / attribute
- reference
- ids

## 2. SelectorPreset

表示可以独立复用的结果集模板。

字段：

- `id`
- `version`
- `query`
- `defaults`
- `vars`

## 3. ActionPreset

表示对结果集执行的动作模板。

字段：

- `id`
- `version`
- `kind`
- `steps`
- `targeting`

## 4. ScenarioPackage

表示完整场景模板。

字段：

- `id`
- `version`
- `meta`
- `vars`
- `nodes`
- `entry`
- `outputs`
- `policy`
- `capabilities`

说明：

- `selector` 与 `action` 是 `nodes[*].kind` 的语义家族
- canonical outer shape 不再额外保留并列的顶层 `selector` / `action`

## 4A. ScenarioNode

字段：

- `id`
- `kind`
- `input?`
- `depends_on?`
- `output_slots?`

说明：

- `depends_on` 是显式边集合
- `output_slots` 用于声明可被 `node_output` 引用的稳定槽位

### SelectorNode

字段：

- `kind`
  - `selector`
- `selector_kind`
  - `query`
  - `preset_ref`
- `input`

说明：

- 默认 `output_slots` 至少包含 `selection`

### TransformNode

字段：

- `kind`
  - `transform`
- `transform_kind`
  - `set_op`
  - `project`
  - `limit`
  - `sort_projection`
- `input`

说明：

- 只允许 host-independent transform algebra

### ActionNode

字段：

- `kind`
  - `action`
- `command_id`
- `input`

说明：

- `command_id` 必须最终 lowering 到 canonical business command 或 `apply kind=actions`
- `command_id` 的 authoring 主语默认保持业务语义，不要求 caller 显式改写为 performance-oriented bulk family
- internal bulk family 若存在，只作为 host runtime lowering / execution 事实，不作为 canonical package 默认输入
- 默认 `output_slots` 可包含：
  - `receipt`
  - `id_map`
  - `durable_target`

## 5. ScenarioVariable

字段：

- `name`
- `type`
- `required`
- `default?`
- `description?`

## 6. ScenarioPolicy

字段：

- `wait`
- `remote_parity_required`
- `max_items`
- `idempotency`
- `fallback_strategy?`

说明：

- `fallback_strategy` 只允许 host-independent outcome policy：
  - `fail`
  - `allow_empty_selection`
  - `skip_optional_outputs`

## 7. SelectionSet

表示 selector 执行后的统一结果集。

字段：

- `items`
  - 每个 item 至少包含 `rem_id`
- `total_selected`
- `truncated`
- `source_nodes`
- `lineage`
- `fields?`
- `warnings?`

说明：

- `SelectionSet` 是 host runtime materialize 出来的事实对象
- shared contract 只负责其 schema、normalize 与只读语义
- client 不得把自制 `SelectionSet` 作为执行输入提交给宿主
- `query` 读命令的 preview item 不等于 `SelectionSet` canonical shape
- `fields?` 仅在 node 已声明 projection contract 时出现

## 8. ScenarioExecutionPlanV1

表示 `ScenarioPackage` 的执行中间态。

字段：

- `version`
- `source_package`
- `phase`
- `vars_bound`
- `selector_plan`
- `selection_sets`
- `transform_plan`
- `action_plan`
- `compiled_execution?`
- `scheduling?`
- `diagnostics?`

说明：

- `selection_sets` 是按 node id keyed 的 registry，不是单一字段
- `compiled_execution` 是编译出口 union，例如 `business_command` 或 `apply_actions`
- `phase` 用于区分 planned / resolved / compiled 等单一 IR 阶段
- `planned` 不含 materialized `SelectionSet`
- `planned` 阶段的 `selection_sets` 必须是空 registry
- `resolved` 可包含 `selection_sets`
- `compiled` 可包含 `compiled_execution`
- 该模型可以在 host runtime 中逐步充实，不限定为纯 pre-execution snapshot
- 该模型由 host runtime 生成；shared subpackage 只承载 schema 与 host-independent normalize/validate

### CompiledExecution

字段：

- `kind`
  - `business_command`
  - `apply_actions`
- `command_id?`
- `input?`
- `envelope?`

说明：

- `business_command` 复用现有 canonical command id 与既有 input contract
- `apply_actions` 复用标准 `apply` envelope
- scalar action 到 internal bulk family 的 silent coalescing 属于 host runtime lowering 责任，不改变 public union shape

## 9. StructuredReferenceNode

表示 ScenarioPackage 中的正式引用节点。

字段：

- `kind`
  - `var`
  - `coalesce`
  - `node_output`
  - `selected_field`
  - `selected_path`
  - `literal`
- `name?`
- `node?`
- `output?`
- `field?`
- `path?`
- `values?`
- `value?`

说明：

- 该模型应以 discriminated union 方式校验，不采用“任意 kind + 任意可选字段包”
- `node_output` 可显式指向 node 的命名输出槽位

## 10. ScenarioGenerateHintV1

表示 `scenario schema generate` 的结构化输入。

字段：

- `goal`
- `selector_kind?`
- `action_kind?`
- `source_scope?`
- `target_ref?`
- `vars?`
- `constraints?`
- `capabilities?`

说明：

- 该模型是 canonical hint contract
- 不允许把自由文本 prompt 直接当作 canonical generate 输入

## 11. ScenarioSchemaToolRequest

表示 scenario/package schema tooling 的输入。

字段：

- `mode`
  - `validate`
  - `normalize`
  - `explain`
  - `scaffold`
  - `generate`
- `package?`
- `hint?`
- `vars?`
- `template_id?`
- `scenario_kind?`
- `options?`

说明：

- `package` 用于 `validate` / `normalize` / `explain`
- `hint` 用于 `generate`
- `hint` 必须满足 `ScenarioGenerateHintV1`
- `package` 与 `hint` 不得同时作为 primary input
- `options` 不能替代 canonical `package` 或 canonical `hint`

## 12. ScenarioSchemaToolResult

表示 schema tooling 的稳定输出。

字段：

- `tool`
- `subcommand`
- `schema_version`
- `ok`
- `errors`
- `warnings`
- `hints`
- `diagnostics?`
- `normalized_package?`
- `changes?`
- `summary?`
- `required_vars?`
- `capabilities?`
- `selector_preview?`
- `action_preview?`
- `execution_outline?`
- `template_id?`
- `generated_package?`
- `inputs_used?`
- `assumptions?`

## 13. PresetCatalogEntry

字段：

- `id`
- `kind`
- `owner`
- `source`
  - `builtin`
  - `provider_reserved`
- `title`
- `summary`
- `version`
- `package_path`
- `package_id`
- `package_version`
- `tags`
- `vars`
- `action_capabilities`
- `remote_parity_required`
- `review_status`

说明：

- catalog entry 是 canonical package 的摘要镜像，不替代 package 本体
- 维护者必须能直接从 entry 审核 owner、vars、action capability 与 remote 风险

## 14. PresetProvider

表示未来 provider / 插件扩展位。

字段：

- `provider_id`
- `kind`
- `capabilities`
- `trust_model`

当前只保留接口，不要求实现。

## 15. SharedScenarioContractPackage

表示新的共享子包边界。

字段：

- `package_name`
- `exports`
- `modules`
- `allowed_dependencies`
- `forbidden_dependencies`
- `forbidden_capabilities`

## 16. SchedulingPolicy

表示 scenario / execution plan 可声明的调度偏好。

字段：

- `batching`
- `merge_strategy`
- `parallelism`
- `ordering`
- `dispatch_mode`

说明：

- 这里只表达声明式 hints
- 不表达 batch size、lease、retry、worker election、lock key derivation

## 17. CommandAliasSurface

表示 canonical family 与 alias 的映射关系。

字段：

- `canonical_id`
- `surface`
- `alias_of?`
- `status`
  - `canonical`
  - `alias`
  - `deprecated_alias`
