# 契约：内置 Preset Catalog

日期：2026-03-22

## 目的

定义仓库内置 preset / scenario 集合的归档方式，并让维护者能在 catalog 层完成 owner、vars、capability 与风险审核。

## 必需属性

- `id`
- `kind`
  - `query_preset`
  - `scenario_package`
- `title`
- `summary`
- `source`
  - `builtin`
  - `provider_reserved`
- `owner`
- `version`
- `package_path`
- `package_id`
- `package_version`
- `tags`
- `vars`
  - 每个 var 至少包含：
    - `name`
    - `type`
    - `required`
    - `default?`
- `action_capabilities`
- `remote_parity_required`
- `review_status`

## 审核要求

- 维护者审核一条 builtin entry 时，必须能直接看见：
  - owner
  - vars 摘要
  - action capability 摘要
  - 是否要求 remote parity
  - package 真实落点
- catalog entry 可以是 package 的摘要镜像，但不得替代 canonical package 本体
- `query_preset` 与 `scenario_package` 都必须能通过 entry 追溯到 canonical package

## 治理规则

- builtin catalog 受 repo SSoT 与 tests 约束
- repo 内 builtin scenario 的权威源集中维护在 `packages/agent-remnote/builtin-scenarios/`
- `catalog.json` 与 `packages/*.json` 共同构成 repo truth；运行时代码只做加载与校验，不再在 TS 内手写第二份 package 正文
- user-private preset 不进入 builtin catalog
- user-private scenario 文件可位于 `~/.agent-remnote/scenarios/*.json`，但不进入 builtin catalog，也不替代 repo 内 canonical package
- 若提供 builtin install helper，它只能把 repo 内 canonical package 显式写入用户目录，不能反向覆盖 repo truth
- provider / 插件来源只保留接口，不在 031 实现
- `id` 必须稳定、唯一、可 drift-check
- `owner` 必须显式，不允许匿名 builtin
- 含 action capability 的 entry 必须显式列出 capability family
- 若 entry 依赖未来 public promotion 才能完整工作，必须在 `review_status` 或等价字段中显式标注

## 非目标

- 不在 031 中定义 marketplace / 自动安装 / 远端同步机制
- 不在 031 中把 catalog entry 扩展成独立执行 DSL
