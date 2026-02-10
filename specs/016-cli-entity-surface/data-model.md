# Data Model & Naming: 016-cli-entity-surface

本文件描述 016 的“命令树归属 + 实体术语 + 双视角入口”的裁决点，便于实现与文档/测试对齐。

## Core Entities

- **Rem (RID)**：大纲节点，所有写入最终落到某个 Rem 的结构/内容/关系变更。
- **Portal Container (PoRID)**：`RemType.PORTAL=6` 的容器 Rem，用于投影一个目标 Rem 的子树；DB 表现为 `doc.type=6` 且 `doc.pd` 指向目标 Rem。
- **Portal Target (TRID)**：被 Portal 投影的目标 Rem。
- **Tag Rem (TagId)**：Tag 本体也是 Rem；对 Rem “打标签/移除标签”是变更关系，不创建/删除 Tag Rem。
- **Table Tag (tableTagId)**：Table 以 Tag Rem 表示；record 为 Rem；property/option 以 tableTag 作为作用域。

## Command Ownership (why read/write first)

- `read`: 只读（本地 `remnote.db`、WS state snapshot、派生查询）；失败应明确为 `DB_UNAVAILABLE` / `STALE_UI_CONTEXT` 等可诊断错误。
- `write`: 产生副作用（enqueue → WS → plugin SDK）；必须继承 `--wait` 与 nextActions，引导排障而不是要求调用方预检。
- `write advanced ops`: raw 兜底入口；默认不推荐给 Agent；仅用于 debug/尚未封装的能力。

## Canonical CLI Tree (outline, draft)

> 这是 016 目标形态的“命令归属树（草案）”，用于对齐实现/文档/测试；不保证与当前版本完全一致。

- `doctor`
- `config`
  - `config print`
- `daemon`
  - `daemon serve`
  - `daemon start`
  - `daemon stop`
  - `daemon restart`
  - `daemon ensure`
  - `daemon status`
  - `daemon logs`
  - `daemon sync`
- `queue`
  - `queue stats`
  - `queue inspect`
  - `queue progress`
  - `queue wait`
- `ops`
  - `ops list`
  - `ops schema`
- `read`
  - `read ui-context`
    - `read ui-context snapshot`
    - `read ui-context page`
    - `read ui-context focused-rem`
  - `read selection`
    - `read selection snapshot`
    - `read selection roots`
    - `read selection outline`
  - `read rem`
    - `read rem inspect`
    - `read rem outline`
    - `read rem page-id`
    - `read rem references`
    - `read rem connections`
  - `read portal`
    - `read portal inspect`
    - `read portal target`
    - `read portal contexts`
  - `read table`
    - `read table --id <tableTagId>`
  - `read search`
    - `read search-plugin`
    - `read search`
- `write`
  - `write md`
  - `write bullet`
  - `write rem`
    - `write rem create`
    - `write rem move`
    - `write rem text`
    - `write rem delete`
    - `write rem tag`
      - `write rem tag add`
      - `write rem tag remove`
  - `write portal`
    - `write portal create`
    - `write portal include`
    - `write portal exclude`
  - `write tag`
    - `write tag add`
    - `write tag remove`
  - `write table`
    - `write table create`
    - `write table record`
      - `write table record add`
      - `write table record update`
      - `write table record delete`
    - `write table property`
      - `write table property add`
      - `write table property set-type`
    - `write table option`
      - `write table option add`
      - `write table option remove`
  - `write replace`
    - `write replace block`
    - `write replace text`
  - `write advanced`
    - `write advanced plan`
    - `write advanced ops`

## Dual-surface policy (Tag as example)

同一能力允许有两条“视角入口”，但必须满足：

1) **语义等价**：最终 enqueue 的 op 类型与 payload 一致（或等价映射）。
2) **参数一致**：同名参数相同含义（例如都用 `--rem`/`--tag`），并都支持 deep link 输入。
3) **输出一致**：字段、错误码、nextActions 不因入口不同而漂移。
4) **canonical 推荐路径**：文档与 skill 必须明确 Agent 应优先使用哪条（降低熵）。

## ID Parsing (unified)

- 任意“RemId”形参 SHOULD 支持：直接输入 `remnote://w/<kbId>/<remId>` 或 `https://www.remnote.com/w/<kbId>/<remId>`（仅提取 remId）。
- `--ref` 解析范围：`id:/page:/title:/daily:`（由 `RefResolver` 裁决）。

## Mapping to ops (traceability)

> 高层命令必须可溯源到底层 op 类型，便于排障与 `ops schema` 发现。

- `write portal create` → `create_portal`
- `write tag add/remove` → `add_tag/remove_tag`
- `write rem tag add/remove` → `add_tag/remove_tag`（thin wrapper）
- `write table create` → `create_table`
- `write table record add/update/delete` → `table_add_row` + `set_cell_*`/`table_cell_write`/`update_text` + `delete_rem`

## Example: Nested outline as an unordered list

每个 bullet 对应一个 Rem；缩进表示父子关系；同级顺序即 position 顺序。

- Project
  - Inbox
    - Capture idea
    - Link: remnote://w/<kbId>/<remId>
  - Writing
    - Draft A
      - TODO: polish wording
      - TODO: add examples
    - Draft B
