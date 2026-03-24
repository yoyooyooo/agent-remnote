# 契约：031 的命令 taxonomy

## 核心角色

- `query`
  - 唯一 generic selector owner
- `scenario`
  - package / schema tooling owner
  - package execution namespace 的规划 owner
- `tag`
  - relation primitive owner
- `powerup`
  - metadata 与 PowerUp semantic owner
- `todo`
  - 高频 task semantic family
  - 写侧 current canonical owner 冻结为 `powerup.todo.*`
  - 顶层 `todo add/done/undone/remove` 继续作为显式 alias
  - `todo list` 保留为兼容入口，目标归宿是 `query` preset surface
- `apply`
  - 低层 structured write owner

## 规则

- `tag` 不吸收 `powerup` metadata reads
- `tag` 不拥有 Todo 场景 preset
- `powerup` 可以把很多写入编译到 `tag + property + table` 语义，但仍然保持公开 metadata owner 身份
- `powerup.todo.*` 是 031 写侧 canonical owner
- 顶层 `todo add/done/undone/remove` 必须与 `powerup.todo.*` 保持同参数面、同语义、同回执
- `todo list` 的迁移方向固定为 `query --preset <id>`
- `todo list` 在 query preset parity 完成前继续作为兼容入口存在
- current authoritative inventory 中的 `todos.list` 只作为兼容期条目保留
- 当 `todo list -> query --preset` promotion 完成并移除兼容入口时，`todos.list` 必须同步退出 authoritative inventory；031 不再为它定义新的 standalone inventory id
- `apply` 不接受 scenario package 作为并列执行面
- `scenario run` 是 package execution 的 reserved 薄入口
- `scenario` 子树进入 current public inventory 之前，必须先完成 promotion preconditions
- `scenario builtin list/install` 只负责 builtin catalog 的显式发现与注入，不引入新的 canonical source
- 若未来要翻转 todo 写侧 canonical owner，必须作为全局 SSoT breaking change 单独裁决并显式迁移
- 不引入 workflow-specific 顶层名词

## Promotion Preconditions

- `scenario` 子树若要进入 current public command inventory，必须先完成：
  - authoritative inventory 收录
  - `docs/ssot/agent-remnote/cli-contract.md` 更新
  - `packages/agent-remnote/src/lib/business-semantics/commandInventory.ts` 与 verification mapping 更新
  - root command/help/docs drift coverage 更新
  - 若包含 remote execution，还需补齐 Host API contract、client capability 与 parity tests
- 上述条件未满足前，`scenario schema`、`scenario builtin`、`scenario run` 仅作为 031 feature-local planned namespace 存在
- promotion 前不得把 `scenario-local-remote-parity` 当作 current public gate

## 024 Alignment

- 024 保留的一条有效规则是：scene composition 仍然数据驱动
- 031 在这条基础上，把 scene composition 正式定义为 `ScenarioPackageV1`
- 任何 CLI runner 都必须保持 generic 与 schema-driven

## 候选薄入口

Allowed candidates:

- `query --preset <id>`
- `scenario builtin list|install`
- `scenario run <spec> --var key=value`
- `scenario schema validate|normalize|explain|scaffold|generate`
- `playbook explain|dry-run|run <spec>`

说明：

- `query --preset <id>` 是 `todo list` 的目标归宿
- `scenario ...` 是 031 规划中的目标命令面；promotion preconditions 完成后才进入 current public inventory

Disallowed examples:

- `weekly-recap`
- `dn-rollup`
- `todo-collect-and-portal`
- 顶层 `schema ...`
- `apply --scenario <id>`
