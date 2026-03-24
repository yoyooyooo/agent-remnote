# 契约：命令树归一化

日期：2026-03-22

## 目的

定义 031 后 `query / scenario / todo / powerup / tag / apply` 的职责边界。

## Canonical Families

- `query`
- `scenario`
- `todo`
- `powerup`
- `tag`
- `apply`

## 已冻结边界

- `query` 是唯一 universal selector owner
- `scenario` 是 package 与 schema tooling 的 owner
- `scenario` 的 execution surface 在 031 中先冻结 namespace 与 promotion preconditions
- `powerup` 是 metadata 与 PowerUp semantic introspection owner
- `tag` 是 relation primitive owner
- `apply` 是低层 structured write owner，只接 canonical actions / ops
- `todo list` 归一化到 `query` preset surface
- `powerup.todo.*` 是 current canonical todo write surface
- 顶层 `todo add/done/undone/remove` 是 current explicit alias

## Alias / Pending Rules

- `powerup.todo.*` 与顶层 `todo` 的写侧关系在 031 内已冻结：
  - `powerup.todo.*` 负责 canonical command id
  - 顶层 `todo.*` 负责高频 alias
- `todo list` 在 query preset parity 完成前保留兼容入口
- `todos.list` 只作为 current inventory 里的兼容期 id 保留
- 兼容期结束时，`todo list` 入口与 `todos.list` inventory id 必须同波次退场，不引入新的 standalone inventory replacement
- `todo list` 的参数映射、alias 生命周期、remote parity 切换条件必须独立成文
- 若未来翻转，必须通过全局 SSoT breaking change 完成
- alias 必须显式、可审计、可迁移

## Scenario Subtree

```text
agent-remnote scenario
  schema
    validate
    normalize
    explain
    scaffold
    generate   # 仅接受结构化 hint
  catalog
    list
    show
  run
```

说明：

- 上述子树在 031 内先作为 feature-local planned namespace 冻结
- current public promotion 依赖后文 preconditions

### `scenario run` 的稳定边界

- 031 先冻结 reserved surface 与输入边界
- 输入主语固定为位置参数 `<spec>`，并接受 repeated `--var`
- `<spec>` 统一承载 `@file`、`-`、inline JSON、catalog ref
- `--package <spec>` 可保留为兼容 alias，但不得成为唯一入口
- 执行前必须走 validate / normalize
- promotion 完成后，local / remote 都必须复用同一业务语义
- 不新增第二套 selector 或 action DSL
- 不以 `apply --scenario ...` 形式复制执行入口

### `scenario` public promotion preconditions

- authoritative inventory 收录 `scenario.schema.*`、`scenario.catalog.*`、`scenario.run`
- `docs/ssot/agent-remnote/cli-contract.md` 与 root command surface 同步
- `commandInventory.ts`、verification-case registry、help/docs drift tests 同步
- `scenario run` 若进入 public surface，还需同步 Host API contract、client capability、stable failure contract、parity tests
- preconditions 完成前，`scenario-local-remote-parity` 只可作为规划占位，不可作为 current public implement gate

## 不可妥协项

- 不允许多个 family 抢同一个主意图
- alias 必须显式、可审计、可迁移
- tooling 命令不得直接承载执行语义
