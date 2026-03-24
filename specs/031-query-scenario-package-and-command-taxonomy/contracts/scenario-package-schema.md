# 契约：ScenarioPackage Schema

日期：2026-03-22

## 目的

定义可复用的高频场景工件。

## 必需区段

- `meta`
- `vars`
- `nodes`
- `entry`
- `outputs`
- `policy`
- `capabilities`

补充约束：

- canonical node family 至少包含 `selector`、`transform`、`action`
- `selector` 与 `action` 是 canonical node family，不是第二套顶层结构
- `nodes[*]` 至少包含：
  - `id`
  - `kind`
  - `input?`
  - `depends_on?`
  - `output_slots?`
- `depends_on` 必须用 node id 显式表达边，不允许通过引用扫描隐式推导 DAG
- `entry` 负责声明起始 selector 节点，且 `entry[*]` 只能指向不带 `depends_on` 的 selector node
- `outputs` 负责声明场景对外暴露的终态节点，输出引用只能是 `node_id` 或 `node_id.output_slot`
- 具体 selector / transform / action 目标必须通过 dedicated subfield 指向 canonical surface，不使用 ad hoc 拼接式 `kind` 命名扩展第二套 taxonomy

## Node 级约束

### `selector`

- 必须声明 `selector_kind`
- 031 只冻结 `selector_kind=query | preset_ref`
- `output_slots` 默认至少包含 `selection`

### `transform`

- 必须声明 `transform_kind`
- 031 只冻结 host-independent transform family：
  - `set_op`
  - `project`
  - `limit`
  - `sort_projection`
- `transform` 不得读取 workspace、transport、UI session、Host API endpoint 或宿主内部状态
- `transform` 的输入必须全部来自 `StructuredReferenceNode`

### `action`

- 必须声明 `command_id`
- `command_id` 必须指向现有 canonical business command family 或 `apply kind=actions` lowering 目标
- `output_slots` 只能暴露 lowering 后稳定可诊断的槽位，例如：
  - `receipt`
  - `id_map`
  - `durable_target`
- `command_id` 默认保持业务语义，不要求 authoring 侧显式使用 performance-oriented bulk family
- internal bulk family 若存在，只能作为 host runtime lowering 结果，不作为 canonical package 的默认 authoring 主语

## 必需不变量

- 不得发明第二套命令体系
- 必须可编译到现有 business command 语义或 `apply kind=actions`
- `apiBaseUrl` 不改变 `ScenarioPackage` 语义，只改变 transport
- schema 允许复杂，但必须保持强表达力、无歧义、可静态校验
- single-selector / single-action 的 authoring 便利形态若存在，也必须先 normalize 到 `nodes + entry + outputs` canonical outer shape 才能继续流转
- `nodes` 必须构成有向无环图，且每个 `outputs[*]` 都必须可从 `entry[*]` 到达
- 每个 `depends_on` 都必须引用已声明 node
- 每个 `StructuredReferenceNode.node_output` 都必须引用已声明 node 与已声明 output slot
- `transform` node 不得直接 lowering 到 business command 或 `apply`
- `action` node 不得携带 raw op 或 host-only DSL
- `policy` 与 `capabilities` 只能声明 host-independent contract，不得声明 mode switch、transport、endpoint、port、路径或 runtime knob

## 设计偏好

- 优先结构化引用，不优先字符串 DSL
- 优先显式类型节点，不优先隐式表达式
- 若复杂度继续提升，优先升级为受约束 DAG，而不是引入任意脚本
- 031 的 canonical schema 允许多节点 DAG，但必须保持无循环、无任意代码、无动态执行路径
- `capabilities` 只声明静态 contract 与执行前提，不承载 transport、endpoint 或宿主内部实现细节
- `policy` 只声明 host-independent outcome policy，不承载 remote fallback、transport fallback 或 scheduler implementation detail

## 来源类别

- builtin
- user
- provider_reserved

## Tooling Requirement

该 schema 必须被正式子命令消费，用于：

- validate
- normalize
- explain
- scaffold 或 generate

## Canonical Authoring Boundary

- JSON 是 canonical execution format
- TS/SDK 若存在，只能作为 optional authoring 层，最终必须编译到 canonical JSON
