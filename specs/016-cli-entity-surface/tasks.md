# 016 · Tasks（可执行清单）

> 约定：forward-only，允许 breaking；所有 CLI 输出/错误信息保持英文；`--json` 模式 stdout 纯净。

## T1：定义并固化 CLI tree（文档裁决）

- [x] 在 `specs/016-cli-entity-surface/spec.md` 补充最终 canonical tree（含顶层命令集合、二级实体集合）。
- [x] 在 `docs/ssot/agent-remnote/cli-contract.md` 补充“命令树归属”裁决（若需要）。

## T2：实现 `write portal` 高层命令

- [x] 新增 `packages/agent-remnote/src/commands/write/portal/index.ts`（subcommands 聚合）
- [x] 新增 `packages/agent-remnote/src/commands/write/portal/create.ts`
  - 输入：`--parent <id|ref>`、`--target <id|ref>`、`--position <n>`、`--wait/--timeout-ms/--poll-ms`
  - 行为：编译为单 txn（优先 `write plan` 或 `write advanced ops` 但对外隐藏），结果回显 `portal_id`
- [x] （可选）新增 `include.ts` / `exclude.ts`（Deferred：需要新增 op 类型 + 插件 handler；当前未纳入 016 主线交付）
- [x] 更新 `packages/agent-remnote/src/commands/write/index.ts` 接入 `write portal`

## T3：补齐 `write rem`（语义入口）

- [x] 扩展 `packages/agent-remnote/src/commands/write/rem/`：
  - `create.ts` / `move.ts` / `text.ts` / `delete.ts`
- [x] 参数统一：优先支持 `--id/--ref` 解析（deep link / id:/page:/title:/daily:）

## T3.1：Tag 双视角入口（Tag 视角 + Rem 视角）

- [x] 保持/对齐 `write tag add/remove`：参数与输出契约稳定（已存在；纳入回归门禁）
- [x] 新增 `write rem tag add/remove` 作为 Rem 视角薄壳（语义等价，不引入新的默认分叉）
  - 参数建议：`--rem <rid|remnote://...>` + `--tag <tagId|remnote://...>`；`--remove-properties` 仅用于 remove
  - 复用 `writeCommonOptions`（notify/ensure-daemon/wait/dry-run/priority/...）
  - 结果与 `write tag ...` 保持一致（txn/op ids + waited 结果）

## T3.2：Table 补齐建表入口

- [x] 新增 `packages/agent-remnote/src/commands/write/table/create.ts`
  - 输入：`--table-tag <tagId|remnote://...>`（TableTag Rem ID），以及二选一：`--parent <rid|remnote://...>` / `--ref <id:/page:/title:/daily:...>`；`--position <n>`（可选）、`--wait/...`
  - 行为：生成 `create_table` op（与插件执行器 1:1 对齐），避免调用方手写 ops
  - 回执：支持 `client_temp_id` 并在 `--wait` 后尝试从 `id_map` 回显 `table_rem_id`（如适用）
- [x] 更新 `packages/agent-remnote/src/commands/write/table/index.ts` 接入 `create`

## T4：命令归属重排（read/write 收口）

- [x] 设计并落地 `write advanced ops`（迁移 `write ops` 或保留薄 alias）
- [x] 新增 `read powerup list`（只读：枚举本地 DB 的 Powerup/内置类型入口）
- [x] 评估并迁移：`daily/topic/todos/db/wechat/replace` 到 `read ...` / `write ...`
- [x] 更新 `packages/agent-remnote/src/commands/index.ts` 的顶层子命令集合

## T5：测试与文档同步

- [x] contract：新增 `packages/agent-remnote/tests/contract/write-portal-create.contract.test.ts`
- [x] contract：新增 `packages/agent-remnote/tests/contract/write-table-create.contract.test.ts`
- [x] contract：覆盖 Tag 双视角一致性（`packages/agent-remnote/tests/contract/write-tag-rem.contract.test.ts`）
- [x] help contract：固化顶层命令集合与关键子命令
- [x] 文档：更新 `docs/ssot/agent-remnote/tools-write.md` 与 `README.md` / `README.zh-CN.md`
- [x] 更新 `$remnote` skill：把 portal 的推荐写法改成 `write portal create`（避免 raw ops）
