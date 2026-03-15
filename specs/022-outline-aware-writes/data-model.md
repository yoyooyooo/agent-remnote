# 数据模型：022-outline-aware-writes

## 1. 内部结构判定结果

用途：这是内部编译与路由层使用的语义，不直接暴露成公开 CLI 参数。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `outline_suitable` | boolean | 是否适合优先大纲化 |
| `write_style` | string | `normal` / `single_root_outline` / `expand_existing` |

说明：

- `outline_suitable=false` 时允许正常写法
- `single_root_outline` 与 `expand_existing` 是内部结论，不要求调用方显式选择

## 2. Target Selector

用途：让基础命令以最小增量表达“写到哪里”。

建议公开 target selector：

| 选择器 | 含义 |
| --- | --- |
| `--rem <id>` | 显式目标 Rem |
| `--selection` | 当前 selection 的唯一根 |

说明：

- `--selection` 是 canonical `rem children replace` 路径上的公开 target selector
- `replace markdown` 保留其现有 local-only block target 语义，但不进入默认 Agent-first rewrite path
- selection 为空或不是单根时应 fail-fast

## 3. Structure Assertions

用途：让调用方约束结果形态，而不是通过场景词控制过程。

建议公开断言：

| 断言 | 含义 |
| --- | --- |
| `single-root` | 最终结果只有一个顶层根节点 |
| `preserve-anchor` | 现有 anchor Rem 未被替换掉 |
| `no-literal-bullet` | 本应为普通文本的单条列表项没有残留字面 "- " |

说明：

- `--assert` 是结果断言，不是写入意图。
- 它不负责告诉系统“这段内容属于报告/扩写/普通写法中的哪一类”。
- 它只负责约束最终结果必须满足哪些结构条件。
- 如果断言失败，系统应明确返回失败或等价的结构不满足结果，而不是静默成功。
- 第一版断言集合固定为：
  - `single-root`
  - `preserve-anchor`
  - `no-literal-bullet`
- 第一版不支持：
  - 断言表达式
  - 用户自定义断言
  - 任意组合逻辑

## 4. Backup Policy

用途：控制 replace 类命令的 backup 行为。

建议公开值：

| 值 | 含义 |
| --- | --- |
| `none` | 默认值；成功路径不保留可见 backup |
| `visible` | 显式保留可见 backup |

说明：

- backup policy 是执行策略，不是场景语义

## 4.1 公开命令与参数集中说明

这一节只解释“本轮规划中的公开命令面变化”，避免分散在各章节里难以追踪。

### A. 新增命令

#### `backup list`

- 作用：列出 backup artifact
- 类型：对象级治理命令
- 默认行为：只读
- 公开参数：
  - `--state`
  - `--kind`
  - `--older-than`
  - `--limit`
  - `--json`

#### `backup cleanup`

- 作用：清理 orphan backup
- 类型：对象级治理命令
- 默认行为：dry-run
- 公开参数：
  - `--state`
  - `--kind`
  - `--older-than`
  - `--apply`
  - `--json`

### B. 现有命令增强

#### `rem children replace`

- 新增 `--selection`
  - 用当前 selection 的唯一根作为目标
- 新增 `--backup none|visible`
  - 控制 backup 是否在成功路径保留
- 新增 `--assert <name>`
  - 对结果结构做强约束

#### `replace markdown`

- 保留为 advanced/local-only 的块级替换入口
- 不再作为并列的 Agent-primary 结构重写命令增强
- 文档与帮助面必须明确它解决的是 selected-block / block-range replace，而不是默认 expand-in-place

#### `daily write`

- 不新增公开场景型参数
- 只在内部增强单根判断与 bundle 选择

### C. 本轮明确不引入的公开设计

- 不新增 `--intent`
- 不新增 `--shape`
- 不新增 `rem expand`

原因：

- 这些更像 Agent 的内部推理结果或场景语义
- 不符合“公开 CLI 尽量原子化、可组合、面向基础能力”的原则

## 4.2 命令面分层

### Agent-primary primitives

| 命令族 | 说明 |
| --- | --- |
| `apply` | 统一低层写入入口 |
| `rem` | 基础 Rem 对象操作 |
| `tag` | 标签关系操作 |
| `portal` | Portal 基础操作 |
| `backup` | backup artifact 治理 |

### Advanced / local-only

| 命令族 | 说明 |
| --- | --- |
| `replace markdown` | 仅用于块级范围替换；不属于默认 Agent-first rewrite path |

### Convenience reads

| 命令族 | 说明 |
| --- | --- |
| `daily rem-id` | Daily 定位快捷入口 |
| `plugin current --compact` | 最短上下文读取 |
| `table show` | 结构化记录视图 |
| `powerup list/resolve/schema` | PowerUp 发现与 schema 查看 |

### Ops / lifecycle

| 命令族 | 说明 |
| --- | --- |
| `daemon` | WS bridge 生命周期 |
| `api` | Host API 生命周期 |
| `plugin` | 本地插件静态服务与状态 |
| `stack` | 编排型命令 |
| `queue` | 队列治理与诊断 |
| `doctor` | 综合诊断 |
| `config` | 配置管理 |

## 4.3 `table` / `powerup` 双表面裁决

### 主表面

- `table` 作为结构化记录 / 列 / 选项写入的主表面

### 从公开写入面删除的表面

- `powerup` 写命令从公开写入面删除
- `powerup` 读命令保留：
  - `list`
  - `resolve`
  - `schema`

原因：

- `table` / `powerup` 在 record / option / property 上有明显语义重叠
- 主表面必须唯一，才能降低 Agent 选择成本

## 5. Backup Registry（Store DB）

用途：记录 replace 类操作产生的 backup artifact 生命周期。

建议表：`backup_artifacts`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `backup_id` | TEXT PRIMARY KEY | registry 主键 |
| `backup_rem_id` | TEXT | 对应 backup Rem id |
| `source_txn_id` | TEXT NOT NULL | 来源事务 |
| `source_op_id` | TEXT NOT NULL | 来源操作 |
| `backup_kind` | TEXT NOT NULL | `children_replace` / `selection_replace` |
| `cleanup_policy` | TEXT NOT NULL | `auto` / `visible` |
| `cleanup_state` | TEXT NOT NULL | `pending` / `orphan` / `retained` / `cleaned` |
| `source_parent_id` | TEXT | 原父节点 |
| `source_anchor_rem_id` | TEXT | 原锚点 Rem |
| `created_at` | INTEGER NOT NULL | 创建时间 |
| `updated_at` | INTEGER NOT NULL | 最近更新时间 |
| `cleaned_at` | INTEGER | 清理完成时间 |
| `last_error` | TEXT | 最近一次 cleanup 失败原因 |

约束：

- `cleanup_policy=auto` 的 backup 在成功路径中不应长期存在
- `cleanup_policy=visible` 的 backup 允许保留，但仍进入 registry
- `backup_rem_id` 可为空，只用于极早失败边界

## 6. Backup PowerUp

用途：在 RemNote 可见世界里给 backup Rem 一个统一可检索标记。

统一命名：

- Title：`agent-remnote backup`
- Code：`agent_remnote_backup`

后续若再引入其它内部 PowerUp，一律以 `agent-remnote` 为前缀。

## 7. Backup PowerUp 字段

这些字段用于在 UI / 表格视图里快速看懂 backup Rem 的来源与状态。

建议字段：

| 字段名 | 建议类型 | 说明 |
| --- | --- | --- |
| `Kind` | single_select | `children_replace` / `selection_replace` |
| `Cleanup Policy` | single_select | `auto` / `visible` |
| `Cleanup State` | single_select | `pending` / `orphan` / `retained` / `cleaned` |
| `Source Txn` | text | 来源事务号 |
| `Source Op` | text | 来源操作号 |
| `Source Parent` | text | 原父节点 |
| `Source Anchor` | text | 原锚点 Rem |
| `Created At` | text | 创建时间 |

说明：

- 优先走 plugin-owned PowerUp schema registration
- 若 typed schema 路径暂不稳定，最小 fallback 是“统一 Tag + Store DB registry”

## 8. Orphan 定义

orphan 不是单看 PowerUp 标签得出的，而是 registry + Rem 状态联合判断。

建议定义：

- 带有 `agent-remnote backup` 标记，或 registry 中存在对应记录
- `cleanup_policy=auto`
- 来源 txn/op 已终态
- backup Rem 仍然存在
- 超过最小 age 阈值

只有满足这些条件，才进入 `backup cleanup` 候选集。

## 9. 新命令模型

### `backup list`

用途：列出 backup artifact。

建议参数：

| 参数 | 说明 |
| --- | --- |
| `--state orphan\|pending\|retained\|all` | 默认 `orphan` |
| `--kind children_replace\|selection_replace\|all` | 默认 `all` |
| `--older-than <duration>` | 最小年龄 |
| `--limit <n>` | 输出条数 |
| `--json` | 机器可读输出 |

### `backup cleanup`

用途：清理 orphan backup。

建议参数：

| 参数 | 说明 |
| --- | --- |
| `--state orphan` | 默认值 |
| `--kind children_replace\|selection_replace\|all` | 可选 |
| `--older-than <duration>` | 可选 |
| `--apply` | 真正执行删除 |
| `--json` | 机器可读输出 |

默认行为：

- 不带 `--apply` 时只做 dry-run

## 10. 现有命令行为变更

### `daily write`

关键变化：

- 内部识别单根 Markdown 报告，跳过不必要的 bundle
- 不适合大纲化时，允许正常写法
- 不新增公开场景型参数

### `rem children replace`

建议新增：

- `--selection`
- `--backup none|visible`
- `--assert <name>`（可重复）

### `replace markdown`

建议调整：

- 保留现有块级替换语义
- 帮助、文档、skill 中明确标为 advanced/local-only
- 不再作为并列的 canonical rewrite surface 承接 `--backup` / `--assert` 的主公开契约

## 11. 真相源分工

| 层 | 角色 |
| --- | --- |
| Store DB | backup 生命周期真相源 |
| PowerUp | UI 内的可见索引和人工清理抓手 |
| CLI 命令 | 面向 Agent 的原子入口 |
| Plugin 执行器 | 实际创建、删除、回滚 backup artifact |
