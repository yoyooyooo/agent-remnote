# 016 · 实施计划（可分阶段落地）

## Phase 0：裁决与对齐（文档先行）

- 固化 canonical CLI tree（以 `read/write` 为主入口，系统域独立）。
- 明确 Portal/Reference 概念边界与缩写（PoRID/TRID/FPID 等）。
- 明确 breaking 策略：旧入口如何处理（删除/alias/迁移窗口）。

## Phase 1：写入高层命令（Portal/Rem/Tag/Table）

- `write portal create/include/exclude`（内部编译为 op/plan，继承 `--wait`/诊断契约）
- `write rem create/move/text/delete`（补齐现有缺口，统一命名与参数）
- Tag 双视角（语义等价，参数/输出一致；明确 canonical）
  - `write tag add/remove`
  - `write rem tag add/remove`
- Table 补齐高频缺口
  - `write table create`（避免建表退回 ops）
- 为高层命令补齐最小 contract tests（JSON envelope、exit code、wait、参数校验）。

## Phase 2：命令树重排（归属调整）

- 把散落的读命令收敛到 `read ...`（如 `daily/topic/todos/db` 的 read 面）。
- 把散落的写命令收敛到 `write ...`（如 `wechat`/`replace` 的写面）。
- 增补 discoverability：`read powerup list`（枚举本地 DB 的 Powerup/内置类型入口）。
- `write ops` 下沉到 `write advanced ops`（或等价结构）；`ops list/schema` 保持为 discoverability 工具。

## Phase 3：文档/skill/README 同步与回归门禁

- 更新 SSoT：`docs/ssot/agent-remnote/tools-write.md`、必要时补 `cli-contract.md` 的命令树章节。
- 更新 `README.md` / `README.zh-CN.md` 与 `$remnote` skill 的高频 recipes。
- 增加 help contract（顶层命令与关键子命令集合）避免树漂移。
