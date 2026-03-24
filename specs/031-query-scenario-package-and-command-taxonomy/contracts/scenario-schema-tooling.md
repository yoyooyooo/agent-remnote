# 契约：Scenario Schema Tooling

日期：2026-03-22

## 目的

定义 `scenario schema` 这组正式子命令的职责、参数面与输出 contract。

## 命令树

```text
agent-remnote scenario
  schema
    validate
    normalize
    explain
    scaffold
    generate
```

## 总体规则

- 所有子命令消费 canonical schema
- 所有 `--json` 输出必须保持 envelope 稳定
- tooling 只处理 schema，不直接执行 scenario
- `generate` 若保留，只接受结构化 hint
- `scenario run` 是 sibling reserved surface，不属于 schema tooling
- 配置 `apiBaseUrl` 时，`scenario schema *` 仍然在本地执行 shared contract tooling
- `scenario schema *` 不得因为 remote mode 配置而 fail-fast

## 统一输入面

建议所有 `scenario schema *` 至少支持：

- `--spec <spec>`
  - inline JSON、`@file`、`-`
- `--json`
- `--strict`
- `--schema-version <n>`

补充支持：

- `--var <key=value>`
  - 仅给 `explain` 的 host-independent preview
- `--hint <spec>`
  - 仅给 `generate`
  - 输入必须是 `ScenarioGenerateHintV1`
- `--template <id>`
  - 给 `scaffold`
- `--kind <scenario-kind>`
  - 给 `scaffold` 与受限 `generate`
- `--out <path>`
  - 给 `normalize` / `scaffold` / `generate`

## 子命令职责

### `validate`

- 校验 schema 合法性
- 校验版本、字段、不变量、capabilities
- 不承担 mutating canonicalization
- 可以返回诊断，不产出 canonical 持久化结果

### `normalize`

- 产出 canonical 化结果
- 消除字段别名、补默认值、固定顺序

### `explain`

- 解释 selector、action、vars、capabilities、host-independent execution outline
- 不做自然语言生成

### `scaffold`

- 生成空模板或按模板类型生成骨架

### `generate`

- 只接受结构化 hint
- 不接受自由文本 prompt
- 输出仍必须是 canonical schema
- `--hint` 是必填输入，`--spec` 与 `--hint` 不得同时作为 primary input

## 与 `scenario run` 的边界

- `scenario schema *` 只做创建、校验、规范化、解释
- `scenario run` 只接受 canonical package 与 vars
- `scenario run` 的输入主语固定为位置参数 `<spec>`
- `--package <spec>` 只保留为兼容 alias
- `scenario run` 不得吸收 `query` 的 bespoke selector flags
- `scenario run` 不得暴露 `ScenarioExecutionPlanV1` 作为公开输入
- `scenario schema explain` 不 materialize `SelectionSet`，也不生成 host-bound execution plan

## Machine-Readable 输出要求

最少字段：

- `tool`
- `subcommand`
- `schema_version`
- `ok`
- `errors[]`
- `warnings[]`
- `hints[]`

细分建议：

- `validate`
  - `diagnostics[]`
- `normalize`
  - `normalized_package`
  - `changes[]`
- `explain`
  - `summary`
  - `required_vars[]`
  - `capabilities[]`
  - `selector_preview`
  - `action_preview`
  - `execution_outline?`
- `scaffold`
  - `template_id`
  - `generated_package`
- `generate`
  - `generated_package`
  - `inputs_used`
  - `assumptions[]`
