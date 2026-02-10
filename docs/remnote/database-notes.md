# RemNote 本地数据库结构备忘

总导航：`docs/remnote/README.md`（本文件是“只读结构笔记”，不要把写入方案建立在直接改库之上）

> 基于本地 `~/remnote/` 目录下最新的 RemNote 实例数据库（如 `~/remnote/remnote-<accountId>/remnote.db`）的探索，帮助后续开发自用 CLI/脚本、后端服务时理解本地数据结构。内容仅供参考，RemNote 版本升级可能变更字段与逻辑。

## 核心表

### quanta
- **作用**：保存每条 Rem（含每日笔记）主体 JSON。
- **关键字段**（均存于 `doc` JSON 内）：
  - `_id`：Rem ID。
  - `key`：数组结构，记录标题/正文的片段。可包含字符串、引用对象（`{"i":"q","_id":"..."}`）等。
  - `parent`：父 Rem ID。
  - `f`：排序键（如 `a0`、`a1`、`aW`），控制同级顺序。
  - `createdAt` / `u` / `m` / `y` 等：时间戳相关元信息。
  - `k`：路径键（父 ID + 文本），常用于索引。
  - 其他字段（`tp`、`e`、`ic` 等）与 Rem 类型/标签相关。
- **触发器**：
  - `addRemToRecomputeOnInsert` / `addRemToRecomputeOnUpdate`：写入 `pendingRecomputeRems`，提示宿主重建索引。
  - `deleteSearchInfoOnQuantaDelete`：删除关联搜索索引。
- **插件文档补充（Tags & Properties）**：
  - RemNote 表格是建立在 Tag + Property 之上的：列（Property）本质是表头 Tag 的子 Rem，并通过 `setIsProperty(true)` 打上属性标记；属性类型枚举对照见插件文档 `PropertyType`（`text`、`number`、`multi_select`、`date` 等）。
  - 行即为被该 Tag 标记的 Rem，`tableRem.taggedRem()` 会返回所有匹配 Rem；数据库中表现为子 Rem（或任意位置 Rem）挂上相同的 Tag ID。
  - 行/列的值通过 `row.setTagPropertyValue(propertyId, RichText[])` 写入，底层会在 Rem JSON 中追加属性映射（可在 `doc.tp` 等字段看到子条目）。插件 API 在上层封装了这些写入逻辑，无需手动维护。
  - 表过滤器 `tableRem.setTableFilter(Query.tableColumn(...))` 其实会生成搜索查询（`Query` 类），底层仍依赖搜索索引和 `remsSearchInfos`；这解释了为什么表格过滤属于搜索派生逻辑而不是单独的表结构。

### remsContents（FTS5）
- **作用**：Rem 文本的全文索引，虚拟表及其伴生数据：
  - `remsContents_content` / `remsContents_data` / `remsContents_docsize` / `remsContents_idx` / `remsContents_config`。
- **特殊点**：使用自定义 tokenizer `simple`，sqlite CLI 直接访问会报错（缺少扩展）。插入/更新需要宿主营造的环境。

### remsSearchInfos
- **作用**：保存搜索索引用的元数据，连接 Rem 与 FTS。字段包括：
  - `ftsRowId`：对应 `remsContents` 的 rowid。
  - `aliasId` & `id`：Rem ID。
  - `doc`：JSON，包含大量统计字段：`kt`（无引用文本）、`ke`（引用文本）、`rd`（层级深度）、`ic`（子孙统计）、`y`（是否模板）等。
  - `ancestor_not_ref_text` / `ancestor_ref_text` / `ancestor_ids`：祖先缓存文本。
  - `freqCounter` / `freqTime`：频率指标。
- **触发器**：
  - `addRemsSearchRanksOnInsert/Update/Delete`：维护 `remsSearchRanks`。
  - `remsSearchInfosRecursiveInsert` / `remsSearchInfosRecursiveUpdateParent` / `remsSearchInfosRecursiveUpdateText`：维护祖先文本、节点链路。
- **插件文档补充（Search API）**：`plugin.search.search()` 等接口正是对该表及其 FTS 派生数据的封装，支持 `searchContextRemId`、`numResults`、只查 Concepts 等参数；因此若直接查询本地数据库，需要自行处理这些过滤逻辑。

### remsSearchRanks
- **作用**：搜索排名权重。`rank` 由触发器根据 `doc` 中的多个指标（w、wl、i、rd、y、t、u、tc、x、k 等）计算。

### pendingRecomputeRems
- **作用**：待重建索引的 Rem 队列，字段：`id`、`isSearchable`。插入/更新 Rem 后自动写入，客户端会消费并重算索引。

### staged_changes_*
- **作用**：同步增量队列，用于记录本地对 `quanta`、`knowledge_base_data` 等集合的修改。
  - 示例：`staged_changes_quanta(_id, time, changes, num_updates)`。
  - 正常编辑会写入此处；直接改 `quanta` 不会自动生成记录，可能导致不同步。

### sync / sync2 / client_sync_log / sync_debug_logs
- **作用**：与云端同步相关的表，存储增量、日志、调试信息。字段结构以 JSON 为主。

### cards / descendant_cards / spaced_repetition_scheduler
- **作用**：与卡片、间隔重复相关的派生数据。
  - `cards`：卡片实体，`doc` 内含 `rId`（Rem 关联）、`h`（历史复习记录）等。
  - `descendant_cards`：祖先与卡片的映射。

### 其他常见表
- `knowledge_base_data` / `user_data` / `local_stored_data` 等：配置、缓存类信息。
- `remsContents_config` 等：FTS 配置表，通常无需修改。
- **插件文档补充（Powerups 与 Key-Value 存储）**：
  - Powerup 系统在数据库层体现为：自定义 Powerup 注册后会生成一个 Powerup Rem（同样存于 `quanta`），其子 Rem 定义属性；被 Powerup 标记的 Rem 会在 `tp` 区域写入属性/状态标记。`setPowerupProperty(code, property, value)` 与 `setTagPropertyValue` 使用同一套存储机制。
  - 插件还提供 `useSyncedStorageState` / `useSessionStorageState` / `useLocalStorageState` 钩子，用于 Key-Value 存储；这些值并不写入 SQLite，而是存于宿主的同步存储层（与 `quanta` 无关）。

## 触发器总结
- **quanta**：插入/更新 → `pendingRecomputeRems`；删除 → 清理搜索相关表。
- **remsSearchInfos**：插入/更新/删除时同步更新排名、祖先文本。
- 触发器链条保证新增 Rem 的搜索权重、祖先文本、排名一致；跳过这些逻辑会破坏数据。

## 为什么不直接写 SQLite
- FTS5 使用自定义 tokenizer，缺乏扩展无法正常维护 `remsContents`。
- 搜索、排名、祖先链路、同步等依赖多个派生表与触发器，人为补齐难度极大。
- 插入 `quanta` 后虽触发 `pendingRecomputeRems`，但宿主仍需大量计算，“正在升级数据库”提醒即来源于此。
- `staged_changes_*`、`sync*` 不更新将导致云端不同步或历史不一致。

## 插件/自动化写入的建议
- 通过 `remnote-plugin-sdk` 使用官方 API（如 `createRem`、`updateRem`）引导宿主完成所有写入与索引。
- 可在插件中实现 WebSocket 客户端，接受外部服务指令，实现批量导入（参见 `docs/ssot/agent-remnote/ws-bridge-protocol.md`）。
- 避免直接改库；如需只读分析，可在离线副本查看。
- 若需要解析表格/Powerup 属性，可沿着插件文档的模式：先定位 Tag Rem → 读取子 Rem 中 `isProperty` 标记 → 按 `PropertyType` 解释字段，再配合 `tp` 段的值拼出结构化数据。

## 参考命令
- 列出某 Rem 的子节点排序：
  ```bash
  sqlite3 remnote.db "SELECT _id, json_extract(doc,'$.f') FROM quanta WHERE json_extract(doc,'$.parent')='FuXlIeNEdqGlmV9Fn' ORDER BY json_extract(doc,'$.f');"
  ```
- 读取 Rem JSON：
  ```bash
  sqlite3 --json remnote.db "SELECT doc FROM quanta WHERE _id='FuXlIeNEdqGlmV9Fn';"
  ```
- 查看搜索索引元数据：
  ```bash
  sqlite3 --json remnote.db "SELECT * FROM remsSearchInfos WHERE aliasId='FuXlIeNEdqGlmV9Fn';"
  ```

## 后续探查方向
- 如果需要了解更多内部逻辑，可关注 RemNote 插件 SDK 中的接口与事件，或在测试环境中抓包宿主与插件通信。
- RemNote 版本更新时建议重新审查表结构和触发器，确保文档同步更新。


## `doc` JSON 字段拆解
- `_id`：字符串 ID，一般 17 位大小写字母+数字组合。
- `owner`：账户 ID（同目录名中的 long id）。
- `parent`：父 Rem ID，根节点/每日笔记会指向上级文档。
- `key`：数组，混合存储文本片段与引用。
  - 纯文本：字符串元素，例如 `"2025/10/10"`。
  - 引用 Rem：对象 `{ "i": "q", "_id": "..." }`，需要二次查询原 Rem 恢复文本。
  - 富文本/格式片段：对象包含 `t`（文本）、`s`（样式）等，具体含义依赖客户端版本。
- `f`：排序键，按照 ASCII 排序决定同级展示顺序；新插入常见 `a0`、`a1`，可见自定义键 `aW`、`aX` 等。
- `x`：单调递增的整数计数器（所有 Rem 共享），用于客户端排序/去重，插入新 Rem 时递增。
- `createdAt` / `m` / `u` / `y`：毫秒时间戳，分别表示创建、修改、最近活动时间等；部分字段带 `,u`/`,o` 键记录更新时间。
- `k`：路径键，通常为 `"父ID.文本"`；有助于搜索。
- `tp`：类型/标签映射（字典），键为类型 ID，值含 `t`/`u` 等布尔、时间戳字段。
- `e`：额外标记，例如每日笔记 `p.d.2025-10-10`。
- `ic`：布尔/数值标记，疑似与索引或卡片统计有关。
- 其他字段（`o`、`p`、`docUpdated` 等）用于内部状态追踪。

### 引用展开示例
```sql
SELECT json_each.value
FROM quanta, json_each(quanta.doc, '$.key')
WHERE quanta._id = 'FuXlIeNEdqGlmV9Fn';
```
- 若 `json_each.value` 是字符串，直接显示文本。
- 若是对象 `{"i":"q","_id":"..."}`，需要再次查询对应 `_id` 的 `key` 内容。

### 子节点递归示例
```sql
WITH RECURSIVE tree(id, depth) AS (
  SELECT '_ROOT_', 0
  UNION
  SELECT child._id, depth + 1
  FROM quanta child
  JOIN tree ON json_extract(child.doc, '$.parent') = tree.id
)
SELECT id, depth FROM tree;
```
将 `_ROOT_` 替换为目标 Rem ID，可得到整棵子树的层级。

## `remsSearchInfos.doc` 字段观察
- `kt`：去除引用的关键文本，带空格分词，如 `" 框架 / 核心 ： react 、 react - dom"`。
- `ke`：引用文本汇总，通常为空。
- `rd`：深度计数（例如 3 表示第三层）。
- `ic`：与索引/卡片统计有关的数值。
- `w` / `wl` / `x` / `t` / `u` / `tc`：用于 `remsSearchRanks` 计算权重的指标，具体意义未完全解析，但可推测与访问频率、更新时间、收藏等因素相关。
- `p`：父 Rem ID，与 `quanta.doc.parent` 一致。
- `a`：别名 ID（通常与 `_id` 相同）。
- `s` / `k` / `g` / `w` 等布尔字段：标记星标、知识库、列表状态等。
- 触发器会自动维护 `ancestor_not_ref_text`、`ancestor_ref_text`、`ancestor_ids` 三个字段，用于搜索时拼接祖先信息。

## `pendingRecomputeRems` 消费机制
- 插入/更新 Rem 会自动写入 `pendingRecomputeRems`。
- RemNote 客户端检测到新记录后会重建索引、填充 `remsContents`、`remsSearchInfos`。
- 手动插入 `quanta` 时也会触发该队列，但缺乏其他处理逻辑，因此客户端会显示“正在升级数据库”。

## 空 `key` Rem
- `key: []` 代表占位或尚未填写内容的 Rem。
- 常见于模板、自动生成的结构节点，可在数据导出时忽略或特殊处理。

## 备份与本地副本
- 主数据库通常位于 `~/remnote/remnote-<accountId>/remnote.db`，其中 `<accountId>` 为账户哈希；可按目录最新修改时间选择当前使用的库。
- `~/remnote/<env>/backups/RemNote_Backup_YYYY-MM-DD.db.zip` 可得到历史 SQLite 备份。
- `~/remnote/remnote-browser/`、`~/remnote/lnotes/` 等目录也包含 `.db` 文件，可能是不同版本或 Web 版缓存。
- 任何批量操作建议先复制数据库，确保可回滚。

## 命令速查
- 检查 `remsSearchInfos` 记录：
  ```bash
  sqlite3 --json remnote.db "SELECT substr(doc,1,200) FROM remsSearchInfos LIMIT 3;"
  ```
- 统计空 `key` Rem：
  ```bash
  sqlite3 remnote.db "SELECT COUNT(*) FROM quanta WHERE json_extract(doc,'$.key')='[]';"
  ```
- 查询排序键及文本：
  ```bash
  sqlite3 --separator ' | ' remnote.db     "SELECT _id, json_extract(doc,'$.f'), json_extract(doc,'$.key')     FROM quanta WHERE json_extract(doc,'$.parent')='FuXlIeNEdqGlmV9Fn'     ORDER BY json_extract(doc,'$.f');"
  ```

## 表格 / 属性值存储结构

### 行与属性 Rem 的关系
- 表格其实是一个 Tag（如 `Projects`）与其属性 Rem 的组合：Tag 的 `tp` 中列出所有列定义（`ft` 指示类型），列的子 Rem 则代表选项或预设值。
- 每个实际的“行”就是被该 Tag 标记的普通 Rem（常见 `type:1`），其 `h` 数组包含多个 `type:2` 的子 Rem——每个子 Rem 对应一项属性值。

### 属性值 Rem 的共同特征
- `key[0]` 恒为 `{"i":"q","_id":"<属性ID>"}`，`type:2`、`tc:true`，`parent` 指向所属行。
- `value` 字段存储具体值，采用 RichText token 数组，不同列类型表现如下：
  - `single_select`：单个 `{"i":"q","_id":<选项Rem>}`。
  - `multi_select`：若干 `{"i":"q",...}` 之间夹 `{"i":"m","text":","}`；新版 `multi_select_new` 依旧使用引用 token，但可能省略逗号。
  - `checkbox`：`"Yes"`/`"No"` 字符串。
  - `number`：字符串数字（如 `"24"`、`"0"`）；`number empty "0"` 仍以空字符串/空数组区分“未填”。
  - `date`：引用每日笔记 Rem；实际日期需读取被引用 Rem 的 `crt.d`（`s` 为 Unix 秒，`d` 为 ISO 字符串）。
  - `text`/`rich_text`/`url`：`value` 可能混合纯文本 (`{"i":"m","text":...}`)、引用 (`{"i":"q"}`) 与链接 (`{"i":"u",...}`)，解析时需拼接 token。
- 空值通常表现为 `value: []` 或 `null`，需结合属性类型判断是否视为“未填”。
- 属性值 Rem 的 `k` 字段会组合 `<行RemID>.<属性名称>`，便于索引；`value,u` / `value,o` 记录最新更新时间，`ie:true` 表示该节点参与同步。

### 属性定义与选项
- 属性 Rem（如 `Due Date`）带有 `ft`、`opfl`、`tp` 等元数据，`tp` 中继续挂载选项 Rem；选项的 `key` 就是显示文本。
- 关系/引用类选项会通过 `tp` 指向原始 Tag；多选选项同样以独立 Rem 存储，方便被多个行引用。
- 日期列复用每日笔记：日期 Rem 的 `crt.d` 中缓存 `timestamp` 与 `date string`，属性值只需引用该 Rem 即可共享日期语义。

### 解析提示
1. 从行 Rem 的 `h` 遍历所有 `type:2` 子节点，即可收集该行的全部属性值。
2. 依据 `key[0]._id` 反查属性定义，结合 `ft` 决定如何还原 `value`。
3. 多选/引用值需过滤出 `{"i":"q"}` token，再反查文本；URL 需读取 `{"i":"u"}` 内的结构。
4. 日期值需跳转到引用的每日笔记 Rem，读取 `crt.d` 提供的 UTC 秒与格式化日期。

## Search Portal（`u.sp`）结构

### 模板 Rem 与实例标记
- 模板 Rem `_id=urBK647QQl62WV9gp` 带有 `e:"u.sp"` 标记，`tcsp` 存放系统内置的 Search Portal 实例 ID。任何实例都会把模板 ID 写入自身 `tp`，并设置 `type:6`、`portalType:4`。
- 模板下常见四个子节点：`Query` (`rcrs:"sp.q"`)、`Filter` (`rcrs:"sp.f"`)、`Auto For` (`rcrs:"sp.b"`)、`Show Nested Descendants` (`rcrs:"sp.s"`)。实例会复制这些 Rem 来保存查询、筛选、折叠等设置。
- 实例的 `h` 数组保留面板顺序；`ph` / `pd` 记录每个面板或列是否展开、显示以及排序位置（`d:"a0"`、`d:false` 等）。

### 关键字段速览
- `vt`（视图类型）：`1` 为列表/文档视图（最常见），`2` 为表格视图（会启用列配置），`null` 表示旧版 Portal，表现与列表视图一致。
- `qt`（查询类型）：`2` 用于标准 Search Portal，`1` 常见于老式或模板化“嵌入查询”，`null` 沿用默认行为。
- `spo`（排序模式）：`4` 代表使用 `crt.o` 指定的排序规则（如 Pinned、Draft），`1` 多见于模板 Portal，推测表示“按默认/相关度排序”，`null` 则回退到默认排序。
- `searchResults`：缓存最近一次查询得到的 Rem ID 列表，仅作为快照；渲染时仍会重新计算。
- `crt`：运行时快照，`crt.sp` 保存查询与筛选文本，`crt.o` / `crt.g` 分别对应排序、分组设置。

### `crt.sp` 快照
- `crt.sp.q`：引用 `sp.q` 子 Rem，`v` 为 token 列表，`s` 为纯文本展示。
- `crt.sp.f`：引用 `sp.f` 子 Rem，用于属性筛选。
- `crt.sp.o`、`crt.sp.g`：可选，分别指向排序与分组设置。
- `crt.sp` 与 `sp.*` 子 Rem 的 `value` 同步，可以任取其一解析。

### `sp.q`：全文查询语法
- `rcrp:"sp.q"`、`type:2`、`forget:true`。`value` 通常由诸如 `['query: #', {"i":"q","_id":"idD0pavG3mvFiJlgX"}]` 的 token 构成。
- `{"i":"q","_id":...}` token 指向 Tag/Rem；若目标被删，会带 `textOfDeletedRem` 作为兜底文本。
- 语法与 Search Box 一致，可混合关键字、Tag、`contains:` 等指令，最终都映射到 `remsContents` + `remsSearchInfos` 的全文检索。

### `sp.f`：属性筛选语法
- `value` 同样是 RichText token；`slot` 用于分隔“属性引用”与“比较指令”。整个表达式通过括号 + `and`/`or`/`not` 组合，构成一棵前缀 AST。
- Token 中的 `{"i":"q","_id":...}` 既可能指向属性 Rem，也可能指向列的选项 Rem；需结合属性定义的 `ft` 判断。
- 样本中出现的指令：

| 属性类型 (`ft`) | Token 片段示例 | 含义 | 备注 |
| --- | --- | --- | --- |
| `single_select`（新版） | `new_single_select is [ "<OptionID>" ]` | 选中指定选项 | 选项以 ID 字符串存储，需回查 Rem 获取文本。
| `single_select`（旧版/关系） | `select is [ {ref} ]` | 选中引用的选项 Rem | `{ref}` 指向选项 Rem。
| `multi_select` | `multi_select contains [ "<OptionID>" ]` | 集合包含选项 | `[]` 表示值为空。
| `multi_select_new` | `multi_select_new contains [ {ref} ]` | 同上，选项以引用存储 | 需兼容新旧两套语法。
| `checkbox` | `checkbox is unchecked` / `checkbox is checked` | 勾选状态筛选 | 与属性值中的 `Yes/No` 对应。
| `number` | `number greaterThan "66"` / `number empty "0"` 等 | 数值比较、判空 | `"0"` 为占位，勿与实际数字混淆。
| `date` | `date relativeToToday "next" "1" "week"`、`date between "2023-09-18T04:00:00.000Z" "2023-09-22T04:00:00.000Z"` | 日期比较 | 参数依次为范围、偏移、单位；绝对区间使用 ISO 字符串。

- 解析建议：
  1. 预处理 token（去空格、拆括号），按括号构建 AST。
  2. `slot` 前一个引用 token 即属性 ID；结合属性 `ft` 决定如何解析随后的比较指令。
  3. 对 `empty`、空数组等情况做专门分支，避免与数值 0 或空字符串混淆。

### 已捕获语法清单
- **Query 层（`sp.q`）**
  - `query: # {TagRem}`（主流 Tag 搜索）
  - `query: * {PortalRem}`（泛搜索 / Portal 引用）
  - `query:` 前缀 + 任意富文本段（可含 `contains:` 等关键字）
  - 引用 token 支持 `textOfDeletedRem` 兜底文本
- **逻辑运算**：括号 `(` / `)` 与 `and` / `or` / `not` 任意嵌套组合
- **属性比较（全部在 `slot` 语法内出现）**
  - 新版单选：`new_single_select is [ "<OptionID>" ]`
  - 旧版单选 / 关系列：`select is [ {ref} ]`
  - 多选（字符串选项）：`multi_select contains [ "<OptionID>" ]`
  - 多选（引用选项）：`multi_select_new contains [ {ref} ]`
  - 多选空值：`multi_select contains [ ]`
  - 复选框：`checkbox is unchecked`（推测存在 `checked`）
  - 数值：`number greaterThan|greaterThanOrEquals|lessThan|lessThanOrEquals "<N>"`
  - 数值判空：`number empty "0"`、`number is "0"`
  - 日期：`date before "today" ""`、`date relativeToToday "this" "" "week"`、`date relativeToToday "next" "1" "week"`、`date between "<ISO>" "<ISO>"`
  - 组合示例：`( ( date ... ) or ( date ... ) ) and ( not ( date ... ) )`
- **排序 / 分组 / 折叠**
  - `crt.o.s` 引用排序 Rem；`spo = 4` → 启用；`spo = 1/null` → 默认/相关度排序
  - `crt.g`（若存在）引用分组设置
  - `sp.s` (`Show Nested Descendants`) 通过 `h` / `r` 控制层级展开
- **视图与布局**：`vt = 1/2/null`（列表/表格/旧版）；`ph` / `pd` 控制列顺序、折叠
- **缓存字段**：`searchResults`（快照）、`embeddedSearchId`（旧式 Portal）、`h`（面板顺序）
- **推测待补**：可能存在的 `checkbox is checked`、字符串前缀/模糊匹配等尚未在样本中出现，应在扩展解析时保留弹性。

### 排序、分组与折叠
- `crt.o.s` 引用排序 Rem（存于 `u.o.s` Powerup 树），例如引用 `E7jbPXha7eAFnCNQD` 即“Pinned”。排序 Rem 会在 `key` / `value` 中指明排序字段与方向。
- `crt.g` 结构类似，用于分组配置。
- `sp.s`（Show Nested Descendants）以 `h` / `r` 标记是否展开子级。

### Search Portal 执行链（复刻参考）
1. **初筛**：解析 `sp.q`，对 `remsContents` + `remsSearchInfos` 执行全文检索，得到候选 Rem 列表。`remsSearchInfos.doc` 的 `kt`/`ke`、`ancestor_*` 可辅助限制范围或排序。
2. **属性过滤**：解析 `sp.f` AST，结合前文“表格 / 属性值存储结构”读取候选 Rem 的属性值，并执行比较运算。
3. **排序/分组**：若 `spo=4`，根据 `crt.o` 指定的排序/置顶规则重新排序；否则沿用搜索得分或插入顺序。分组逻辑依赖 `crt.g`。
4. **层级展开**：依据 `sp.s` 设置，将命中 Rem 的子级合并进结果或保持单层输出。
5. **缓存**：结果可能写回 `searchResults` 作为快照，但不会驱动后续渲染；自实现时应以即时计算为准。

> 复刻 Search Portal 需具备：RichText→AST 解析、属性值解码、对 `remsSearchInfos` 的检索封装，以及排序/分组枚举与 Powerup 树之间的映射。

## 后续研究提醒
- 若 RemNote 发布 SDK 更新，需关注 `createRem`、`updateRem` 等接口的参数变化。
- 可以通过插件内 `host.getVersion()` 等方法确认宿主版本，保证兼容性。
- 若尝试深入逆向，应在隔离环境操作，避免污染主库。
