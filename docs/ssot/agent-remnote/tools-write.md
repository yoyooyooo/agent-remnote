# agent-remnote 写入命令语义（SSoT）

> 通过 CLI（agent-remnote）将写入/修改操作入队，由 RemNote 插件通过 WS 拉取并执行。

## 术语
- op.type：操作类型。支持“标准类型”（下划线）与“点式别名”（namespace.action）。
- payload：操作参数。可用 camelCase 或 snake_case，服务端会标准化为 snake_case。
- RID：Rem id（大纲节点 id）。
- TagId：Tag 本体也是一个 Rem；`tag add/remove` 操作的是“关系”，不创建/删除 Tag Rem。
- tableTagId：Table 以 Tag Rem 表示；`table ...` 的 `--table-tag` 就是 tableTagId。
- PoRID/TRID：Portal container / Portal target 的 Rem id（Portal 容器是特殊 RemType，不是富文本 token）。
- Deep link：`remnote://w/<workspaceId>/<remId>` / `https://www.remnote.com/w/<workspaceId>/<remId>`；CLI 对所有 “RemId” 参数只提取 `<remId>`。

## 命令一览
- `agent-remnote import markdown`：写 Markdown（树导入；支持 bundle；对应 `create_tree_with_markdown` 等）。
- `agent-remnote daily write`：写入 Daily Note（支持 bundle；对应 `daily_note_write`）。
- `agent-remnote rem create/move/text/delete`：Rem 结构与文本写入（对应 `create_rem`/`move_rem`/`update_text`/`delete_rem`）。
- `agent-remnote portal create`：创建真正的 Portal（SDK `createPortal + moveRems + addToPortal`；对应 `create_portal`）。
- `agent-remnote tag add/remove`：对单个 Rem 增删 Tag（关系写入；对应 `add_tag`/`remove_tag`）。
- `agent-remnote table create`：创建 Table（对应 `create_table`；避免调用方手写 ops）。
- `agent-remnote table record add/update/delete`：Table 视角的记录写入/修改/删除（对应 `table_add_row`/`update_text`/`set_cell_*`/`delete_rem`）。
- `agent-remnote table property add/set-type`：Table 列定义管理（对应 `add_property`/`set_property_type`）。
- `agent-remnote table option add/remove`：select/multi_select 选项管理（对应 `add_option`/`remove_option`）。
- `agent-remnote powerup apply/remove/...`：Powerup(Tag) 视角的封装命令（常见场景：列 schema、给 Rem 打 Powerup Tag 并设置 properties；内部仍生成标准 ops 入队）。
- `agent-remnote replace block/text`：用 Markdown 替换目标 Rem（需要选择/引用/显式 ids；更适合“重排/清理”类任务）。
- `agent-remnote import wechat outline`：抓取 WeChat 文章并写入 RemNote（生成可导入的大纲/Markdown 树；最终仍走队列/插件执行链路）。
- `agent-remnote plan apply`：入队一份批量写入计划（WritePlanV1；支持 `as/@alias` 多步依赖；write-first）。
- `agent-remnote apply`：入队一批 raw ops（advanced/debug 入口；默认 notify/ensure-daemon）。
- `agent-remnote queue stats`：查看队列统计（pending/in_flight/dead/ready_txns；可选 `--include-conflicts` 追加冲突摘要）。
- `agent-remnote queue conflicts`：输出 pending 冲突面报告（用于消费前风险判断与排障）。
- `agent-remnote queue inspect`：查看指定事务/操作详情。
- `agent-remnote queue wait`：阻塞等待事务进入终态（succeeded/failed/aborted），用于 write-first 闭环验证。
- `agent-remnote daemon sync`（或脚本 `ws-trigger-sync.ts`）：通过 WS 通知插件开始同步。

## Agent 工作流（write-first）

- 默认直接执行写入（实体命令的动词子命令 / `apply` / `plan apply`），不再单独做“事前检查”；必要的校验与诊断内化在写入命令中。
- 失败时返回稳定的 `error.code` + `hint`（英文），用于指导下一步修复（例如配置/队列 DB/引用解析/缺少 parent 等）。
- 成功时返回 `txn_id/op_ids`，并附带 `nextActions`（英文命令）用于闭环验证（例如 `queue inspect` / `queue progress` / `daemon sync`）。
- 需要“同一次调用闭环确认落库”时，优先使用写入命令自带的 `--wait/--timeout-ms/--poll-ms`；`queue wait` 仅作为诊断工具保留。
- 对写入类命令，建议为每次“逻辑写入”提供稳定的 `--idempotency-key`（例如 URL / 文件 hash / 业务 key）。当 key 已存在时，CLI 会复用既有 txn（`deduped=true`），避免重复入队与重复写入。

协议补充（与 `docs/ssot/agent-remnote/cli-contract.md` 对齐）：

- `--json`：stdout 单行 JSON envelope，stderr 必须为空；写入类命令成功时 `data.nextActions` 必须可执行且为英文命令。
- `--ids`：仅在成功时输出 ids（逐行），stderr 必须为空；用于上游脚本/Agent 做最短链路的后续拼装。

## apply（raw 入队，advanced/debug）
- 入参（`--payload` 支持 `ops[]` 或 `{ ops, priority?, clientId?, idempotencyKey?, meta? }`）
  - `ops: { type: string; payload: any; idempotencyKey?; maxAttempts?; deliverAfterMs? }[]`
  - `priority?`/`clientId?`/`idempotencyKey?`/`meta?`
- 默认行为：入队后触发一次同步（notify=true，ensure-daemon=true）；可用 `--no-notify` / `--no-ensure-daemon` 关闭。
- 标准类型（部分示例）
  - rem 基础：`create_rem`/`create_portal`/`create_single_rem_with_markdown`/`create_tree_with_markdown`/`replace_selection_with_markdown`/`create_link_rem`/`update_text`/`move_rem`/`delete_rem`
  - 日常笔记：`daily_note_write`
  - 标签/属性：`add_tag`/`remove_tag`/`set_attribute`
  - 表/属性：`create_table`/`add_property`/`set_property_type`/`set_table_filter`/`add_option`/`remove_option`
  - 表行/单元格：`table_add_row`/`table_remove_row`/`set_cell_select`/`set_cell_checkbox`/`set_cell_number`/`set_cell_date`/`table_cell_write`
  - 其他：`add_source`/`remove_source`/`set_todo_status`
- 入队语义：CLI 在入队前会 canonicalize `op.type`（别名统一转为标准类型）；后续冲突键/ID 字段提取/依赖替换均基于标准类型。
- 点式别名（可直接使用；会自动映射为标准类型）
  - `rem.create` → `create_rem`
  - `portal.create` / `rem.createPortal` → `create_portal`
  - `rem.updateText` → `update_text`
  - `table.addRow` → `table_add_row`
  - 其余常见别名已覆盖。
  - payload 键（自动规范化）
  - 示例：`parentId`/`parentID` → `parent_id`，`clientTempId` → `client_temp_id`，`clientTempIds` → `client_temp_ids`，`isDocument` → `is_document`，`addTitle` → `add_title` 等。
  - `create_portal`（创建 Portal：在 parent 下插入“传送门”投影到目标 Rem）
    - `parentId`/`parent_id`（必填）：Portal 容器插入位置（父 Rem id）
    - `targetRemId`/`target_rem_id`（必填）：被投影的目标 Rem id
    - `position`（可选，0-based）：插入到父级 children 的位置（默认 0）
    - 语义：插件侧以 `plugin.rem.createPortal()` 创建 portal 容器 → `moveRems` 定位 → `targetRem.addToPortal(portalId)` 绑定目标
  - `create_tree_with_markdown`（Markdown 导入树）
    - `markdown`（必填）：Markdown 字符串
    - `parentId`/`parent_id`（必填）：父 Rem id
    - `indentMode`/`indent_mode`（可选，默认 true）：是否启用“按缩进建树”的自研导入器；传 `false` 则强制走 RemNote 原生 `createTreeWithMarkdown`
      - indent 模式为“行级导入”：每行优先用 `createSingleRemWithMarkdown` 解析为富文本（失败降级为纯文本 setText），再按缩进关系挂到对应 parent 下；不会像原生导入那样按 Markdown 块结构（段落/列表/标题）整体建树。
      - todo：`- [ ]` / `- [x]` 会被转换为 RemNote todo（文本会去掉 `[ ]`/`[x]` 前缀）。
      - id 引用：`((<remId>))` 会在导入后尝试修正为“按 RemId 的引用”（仅当该 id 可解析），避免意外创建“名字=remId”的 Rem。
    - `staged`/`staging.enabled`（可选，默认 false）：视觉增强导入（staged import）
      - 语义：先在父级下创建临时容器 Rem，并在其下完成导入，最后一次性 `moveRems` 把根节点移动到 `parentId`（减少“逐层出现”的 UI 抖动）。
      - 失败语义：若最终 move 失败，会 best-effort 自动回滚（删除 staging 容器及其子树，并清理可能已移动的根节点），避免留下过渡项/孤儿 Rem；成功时会删除临时容器。
    - `indentSize`/`indent_size`（可选，默认 2）：indent 模式下每级缩进空格数
    - `parseMode`/`parse_mode`（可选）：`raw`/`ast`/`prepared`
      - `raw`：强制走 RemNote 原生导入（等价于 `indent_mode:false`）
      - `ast`：插件用 remark 解析 Markdown，按标题分段导入（标题用 `createSingleRemWithMarkdown`，正文用 `createTreeWithMarkdown`）
      - `prepared`：同 `ast`，但使用 `prepared.items`（适合上游先做分段）
    - `prepared`（可选）：`{ preface?: string; items: { heading: string; body: string }[] }`（仅 `parse_mode:"prepared"` 使用）
    - `position`（可选，0-based）：控制插入到父级 children 的位置。实现为“原生 `createTreeWithMarkdown` 导入 → 只移动根节点（`parent==parentId`）到指定位置（保序）”，避免把子节点抬平导致结构/顺序错乱。注意 `position` 依赖执行时的 sibling index，页面并发编辑会导致插入点漂移；位置敏感场景优先用 `replace_selection_with_markdown(target.mode='expected')`。
    - `bundle`（可选）：`{ enabled: boolean; title: string }`
      - 用途：避免把大量导入内容“直接插入到现有页面根下”。当 `bundle` 存在时，插件会先创建一个“容器 Rem”，并把 Markdown 导入到该容器之下；**容器 Rem 的文本即 bundle title**（若缺字段则自动降级）。
      - 语义：`position`（如提供）用于定位“容器 Rem”的插入位置；容器内部的导入不再二次应用 `position`。
      - 回执：result 会包含 `bundle.rem_id`（容器 Rem），并把顶层 `created_ids` 收敛为 `[bundle.rem_id]` 以便上游快速定位/回滚。
  - `daily_note_write`（写入 Daily Note；由插件侧定位当天 daily doc）
    - `markdown` / `text`：二选一（内容）
    - `date` / `offset_days`：二选一（目标日期）
    - `prepend`（可选）：true 则插入到 daily doc 顶部
    - `bundle`（可选，同上）：当内容很大时建议启用；写入会先创建容器 Rem（容器文本为 bundle title），再把内容导入到容器下。
  - `replace_selection_with_markdown`（推荐替代“create + delete”的多 op 方案）
    - `markdown`：新内容
    - `target.mode`：`expected`（默认，更安全）/ `current` / `explicit`
    - `target.remIds`：`expected`/`explicit` 必填；`expected` 用于执行时校验 selection 未变化，`explicit` 直接按 remIds 执行（不依赖 UI selection）
    - `requireSameParent`/`requireContiguous`：默认 true；用于保证“原地替换”语义明确
    - 替换语义（SSoT 裁决：可补偿步骤）
      - 目标：在**同一位置**把一段 Rem（可能 1 个或多个）替换为新的 Markdown 树，同时确保失败不丢数据。
      - 原则：**move 优先、delete 最后**。在新内容稳定就位前，禁止对旧内容做不可逆删除；任何中间状态必须可通过 move 回滚或保留备份。
      - 推荐执行流程（插件侧单 op 内部实现）
        1. 读取目标 Rems 的 `parentId` 与最小 `position`
        2. 创建新 Markdown 树并 move 到 `position`（确保新内容已就位）
        3. 将旧 Rems move 到临时备份容器（可逆；失败则回滚新内容并终止）
        4. 最后尝试 delete 备份容器（等价于删除旧内容子树；若删除失败则回滚：删除新内容、把旧内容 move 回原位，并 best-effort 清理备份容器；仍失败时返回 `backup_rem_id` 供手动处理）
      - 说明：队列 txn 只能保证 **op 顺序**，不能保证跨 op 的 all-or-nothing；要做到“失败可回滚”，必须把替换封装为插件侧的单 op（或等价的可补偿 saga）。
- 入队后默认会通过 WS 主动通知插件开始同步（`notify` 默认 true，可传 `notify=false` 禁用）。

## plan apply（批量计划写入）

目标：让 Agent 用“一次调用”表达多步依赖写入；通过 `as/@alias` 避免手工传递真实 RemId，并由 daemon 在派发前用 `queue_id_map` 完成 temp id → remote id 替换。

- 入参：`agent-remnote plan apply --payload <json|@file|->`
  - payload schema：`specs/012-batch-write-plan/contracts/plan-schema.md`（v1）
- 输出：
  - enqueue-only 成功：`txn_id`、`op_ids[]`、`alias_map`（alias→`tmp:*`），并包含可执行英文 `nextActions[]`
  - `--ids`：逐行输出 ids（txn_id + op_ids），stderr 为空
- 幂等（强烈建议）：
  - 提供 `--idempotency-key` 时，若命中既有 txn，将复用 txn（`deduped=true`）
  - `alias_map` 会写入 txn meta（`write_plan.alias_map`）并在 dedupe 时回显，保证“重试返回稳定 alias_map”
- 规范化：计划编译出的 ops 在 enqueue 前同样执行 `op.type` canonicalize（与 `apply` 完全一致）。
- 引用解析：
  - `@alias` 仅允许出现在 ID 语义字段（action-specific allowlist）；其它字段出现必须 fail-fast
  - daemon 在 dispatch 前对 ID 语义字段做替换：若字段值为 `tmp:*` 且 `queue_id_map` 已有映射，则替换为 remote id（见 013/012 的一致性语义）

- 示例
```
{
  "version": 1,
  "steps": [
    {
      "as": "idea",
      "action": "write.bullet",
      "input": { "parent_id": "id:<parentRemId>", "text": "First bullet" }
    },
    {
      "action": "tag.add",
      "input": { "rem_id": "@idea", "tag_id": "id:<tagId>" }
    }
  ]
}
```

## 同步触发与执行
- 插件默认“自动连接控制通道 + 连接后自动同步”为开；若关闭控制通道，可通过 `agent-remnote daemon sync` 或 `scripts/ws-trigger-sync.ts` 主动触发。
- 执行器默认会对队列做**受控并发**以提升吞吐（可在插件 Settings 里调 `Sync concurrency`）；但对“同一 Rem 内容修改”“同一父级 children 顺序/结构变更”等风险点会自动串行（锁）。
- 默认调度语义：**同一 txn 内按 `op_seq` 串行派发**（前序必须 `succeeded` 才会派发后续 op）；跨 txn 允许并发（受执行器并发度与锁影响）。如需更复杂的依赖关系，可使用 `queue_op_dependencies`（后续再引入高层入口）。
- 插件收到未知类型会标记致命失败（不重试），便于排错；队列/脚本可用 `scripts/queue-inspect.ts` 查看结果。
  - 建议直接用 `agent-remnote queue inspect` 查看事务/操作详情。

### 回执一致性（attempt_id / CAS ack）

- daemon 派发 `OpDispatch` 时会为本次派发生成 `attempt_id`；插件回 `OpAck` 时必须携带同一个 `attempt_id`。
- daemon 落库回执使用 CAS：只允许命中“当前 in_flight attempt”（`status=in_flight AND locked_by=connId AND attempt_id`）的回执修改 queue_ops/queue_op_results/queue_id_map。
- 若回执过期/乱序（例如多客户端切换、lease 回收后迟到），daemon 会返回 `AckRejected`（见 `docs/ssot/agent-remnote/ws-bridge-protocol.md`），并且不会回滚终态。
- `queue_id_map` 是事实表：同 `client_temp_id` 不得漂移；若回执携带的映射与已有映射冲突，daemon 必须拒绝覆盖并产出可诊断错误（例如 `ID_MAP_CONFLICT`）。

### ack 重试与 dedup（避免映射缺失）

- 插件会在未收到 `AckOk` 前重试发送同一个 `OpAck`（attempt_id 不变），用于降低“执行成功但 AckOk 丢失导致重放”的概率。
- 若执行器因 `idempotency_key` 触发 dedup，必须返回与第一次执行一致的 result（至少保证 `created/id_map` 等关键映射不缺失）；当前实现为 **进程内缓存**（不跨重启持久化）。

## 故障排查
- 看 `~/.agent-remnote/ws-debug.log`（服务端）与 RemNote DevTools（插件端）消息。
- 若热更新报端口占用，已加入全局守卫与退出清理；少数情况下提示 1 次后即恢复。
