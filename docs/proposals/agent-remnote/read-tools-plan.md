# agent-remnote 读取工具规划（草案）

> 基于 `docs/remnote/database-notes.md` 的结构分析，梳理可在 CLI 中实现的读取命令及其协作方式，重点利用 RemNote 提供的搜索相关表（`remsSearchInfos`、`remsSearchRanks`、`remsContents` 等）。

## 术语与数据模型（新增）
- Page：顶层 Rem（parentId 为空，或 `rd=1`）。Page 也是 Rem 的一种。
- 常用字段（remsSearchInfos.doc）：
  - `kt` 标题（不含引用）、`ke` 补充文本（含引用展开）、`r` 别名/检索名。
  - `p` 父 ID（顶层为 null/false）、`rd` 深度。
  - `rank`/`freqCounter`/`freqTime`：搜索排序权重。
  - 建议：判断 Page 以 `rd=1` 为主，兼容 `p IS NULL/false`。

## 核心目标
1. 快速定位 Rem：通过搜索索引获取 Rem ID、摘要、父节点信息。
2. 深入读取 Rem：检索 `quanta.doc` 的原始 JSON，解析字段、引用及元数据。
3. 梳理层级：输出指定 Rem 的子树结构，包括排序、文本内容、引用展开。
4. 辅助查询：列出备份或辅助信息，为批量读取/对比提供支持。

## 候选工具

### 1. `search_rem_overview`
- **意图**：依据关键词或正则匹配快速定位 Rem。
- **实现要点**：
  - 主要查询 `remsSearchInfos`：`json_extract(doc,'$.kt')`（无引用文本）和 `json_extract(doc,'$.ke')`（引用文本）。
  - 可选在环境允许时使用 `remsContents` FTS5（`MATCH`）。需注意 RemNote 自带 tokenizer，若 sqlite 缺失扩展则回退到 `LIKE`。
  - 支持 `timeRange`、`createdAfter/Before`、`updatedAfter/Before` 等过滤参数，依赖 `json_extract(doc,'$.ct')`、`json_extract(doc,'$.lm')` 或 `quanta` 表中的时间戳字段。若未显式传入时间窗口，可由上层根据问题语义传入默认值（如最近 30 天）。此外，`timeRange` 也接受 `"all"` 或 `"*"` 表示不限制时间范围。
  - Page 支持（新增）：`pagesOnly=true` 仅返回顶层 Rem；`excludePages=true` 排除顶层 Rem（两者不可同时为 true）。`preferExact=true`（默认）启用“精确置顶”：当标题/别名等于查询（忽略大小写与空格）时置顶展示。
  - 实际实现输出 `id`、`parentId`、`ancestor`，并附带截断后的 `title`、`snippet`、`truncated`；新增 `isPage`（顶层 Rem 判定）。`detail=true` 时增加 `ancestorIds`、`depth`。
  - `snippetLength` 用于控制摘要长度，便于在 LLM 侧权衡 token；`hasMore/nextOffset` 让上游模型自行决定是否翻页。
- **用途**：查找每日笔记、定位特定关键词所在 Rem、准备进一步读取。

### 1.1 `build_search_query`
- **意图**：根据结构化入参生成 Search Portal 风格的查询 AST，便于 LLM 自行组合复杂条件。
- **实现要点**：
  - `root` 字段支持 `text` / `tag` / `rem` / `attribute` / `page` 叶节点，并可通过 `and` / `or` / `not` 组合。`page` 表示 Page 顶层 Rem。
  - 属性过滤复刻官方语法：`equals`、`contains`、`greaterThan`、`between`、`empty`、`relative` 等；字段值区分字符串、引用、多选、日期。
  - 生成结果附带 `limitHint`、`pageSizeHint`、`sort` 等元信息，为执行工具提供分页/排序建议。
  - 返回 `guidance` + `next` 建议，引导后续调用 `execute_search_query`，并提醒 LLM 在条件不足时先补充信息。
- **用途**：在无现成 Portal 模板时快速拼装查询条件，实现“语义 → 查询”转换。

### 1.2 `execute_search_query`
- **意图**：执行 `build_search_query` 生成的 AST，提供统一的检索+分页接口。
- **实现要点**：
  - 逐叶节点收集候选（文本 FTS、标签、属性值等），在内存中组合并评分，避免 SQL 过度复杂化；`maxLeafResults` 控制单条件上限。若 FTS 环境不可用（分词器缺失/语法不兼容），将自动退回到 `LIKE` 策略，并在错误提示中建议改用 `mode="like"` 或默认 `auto`。
  - 支持多种排序：`rank`（默认）、`updatedAt`、`createdAt`、按属性值排序；结果含 `score`、`updatedAt`、`ancestor`、`parentId` 等信息。
  - 响应内置 `hasMore`、`nextOffset`、`totalCandidates` 等分页字段，并提供后续建议（继续分页、调整条件）。
  - 摘要使用 `searchUtils.createPreview`，默认 `snippetLength=200`，必要时由上层传入较短长度节省 Token。
  - 对日期属性支持绝对/相对比较，内部缓存每日笔记的时间戳，兼容 `relative` 查询（诸如“最近 7 天”）。
- **用途**：无需复用现有 Search Portal 亦可完成“一句话 → 条件 → 结果”的流程，成为搜索工具链的拼装中心。

### 2. `inspect_rem_doc`
- **意图**：查看指定 Rem 的完整 `doc` JSON，了解字段细节。
- **实现要点**：
  - 直接从 `quanta` 获取 `_id`、`doc`、`x` 等。
  - 支持递归展开 `key` 中的引用（可选参数：展开层数、是否展开全部或列出引用 ID）。
  - 可输出原始 JSON 与提取后的友好结构（如文本片段数组、排序键、时间戳）。
- **用途**：调试 Rem 数据、验证 LLM 提示、理解元字段含义。

### 3. `outline_rem_subtree`
- **意图**：生成 Rem 子树的有序结构，适合查看每日笔记或大纲。
- **实现要点**：
  - 使用递归 CTE 查询 `quanta`，按 `f` 排序，限制最大深度。
  - 输出 Markdown 无序列表或 JSON 树结构；文本由 `summarizeKey` 转为可读字符串，并保留 `references` ID。
  - 默认分页：可通过 `startOffset`、`maxNodes` 控制单次返回节点数，响应中包含 `hasMore`、`nextOffset`；便于在长文档上分批读取。
  - 仍支持配置最大层级、是否包含空 `key` Rem、是否展开引用等参数。
- **用途**：快速阅读整片笔记、导出摘要、做结构分析。

### 4. `resolve_rem_reference`
- **意图**：批量解析 Rem 引用文本。
- **实现要点**：
  - 输入一组 Rem ID，返回 `key` 展开的文本（与 `inspect_rem_doc`、`outline_rem_subtree` 协作）。
  - 可支持多层展开或仅返回直接 `key` 文本；响应默认提供 Markdown 摘要与 `referenceIndex`（映射引用 ID → 对应文本、来源），并提示继续使用 `outline_rem_subtree`。
  - `detail=true` 时附带 `rawKey/rawDoc` 等调试字段；默认仅返回精简文本与引用 ID，减少 Token。
- **用途**：为其他工具提供引用文本、生成完整大纲。

### 5. `find_rems_by_reference`
- **意图**：以一组锚点 Rem 为目标，反向查找直接或多层引用它们的节点，覆盖“隐性关联”场景。
- **实现要点**：
  - 基于 `quanta.doc.key` 的字符串匹配（如 `instr(json_extract(doc,'$.key'), '"_id":"<target>"')`）检索 `{ "i":"q","_id":"..." }`，结合去重逻辑支持 `maxDepth`（默认 1）逐层扩展。
  - 支持 `timeRange`、`createdAfter/updatedAfter` 等过滤，与文本搜索保持一致；可配置 `maxCandidates` 控制上限。`timeRange` 也接受 `"all"` 或 `"*"` 表示不限制时间范围。
  - 默认输出 Markdown 摘要与精简 `matches`（含 `id/title/snippet/matchedTargets/anchorIds/depth`），并返回 `referenceIndex` 将目标 ID 与命中上下文关联；`detail=true` 时补充 `parentId/ancestorIds/sourceIds/updatedAt` 等完整元数据。
  - 默认启用 `autoExpandDepth`：若当前深度无命中，会在不超过 3 层的范围内逐级放宽，并在响应中返回 `depthAttempts`、`depthApplied`，协助上层判断是否继续扩大搜索范围。
- **用途**：和 `summarize_topic_activity`、`outline_rem_subtree` 等组合，捕捉未显式写出关键词的引用型笔记。

### 6. `list_rem_references`
- **意图**：列出指定 Rem 的所有 `[[引用]]`，含出现次数与可读摘要。
- **实现要点**：
  - 解析 `quanta.doc.key` 以及属性值字段（`doc.value` RichText token），记录每个引用 ID 的出现路径与次数；默认返回去重后的统计与路径列表。
  - 支持 `resolveText`（默认 true）以提取引用 Rem 的无引用文本摘要（`remsSearchInfos.kt`），同时附带祖先链路。
  - 默认 `includeOccurrences=false`，仅返回与界面相近的简要信息；若需要完整路径和每次出现记录，可显式开启；`includeDescendants=true`（可配合 `maxDepth`）时，递归统计整棵子树并在结果中标注命中 Rem。
  - `includeInbound=true` 时同步返回反向链接列表（依赖 `find_rems_by_reference`），结果会附带面包屑、引用深度等信息，可通过 `inboundMaxDepth`、`inboundMaxCandidates` 控制搜索范围。
  - 响应中还会给出 `tokenKinds`（如 reference / portal），帮助区分引用类型。
- **用途**：快速审查某个 Rem 及其子 Rem 在何处引用了哪些概念，为引用梳理或递归展开做准备。

### 7. `get_rem_connections`
- **意图**：统一查看某个 Rem 的“出站引用+入站引用”，便于顺藤摸瓜地探索上下游页面。
- **实现要点**：调用 `list_rem_references includeInbound=true` 获取整体关系，并将结果拆分为 `outbound` / `inbound` 两部分；默认只分析当前 Rem，可通过 `includeDescendants/maxDepth` 扩展到整棵子树。
- **用途**：当用户想快速判断一个 Rem 与其他页面的连接强度时，直接返回两侧列表（含面包屑、引用类型等信息），便于继续深入。

### 8. `summarize_topic_activity`
- **意图**：在给定时间窗口内按关键词/标签汇总用户的记录，回答诸如“最近一个月我记录了什么 rust 相关的内容”。
- **实现要点**：
  - 先利用 `search_rem_overview` 获取主题锚点 Rem（可接受上层传入的 `referenceIds`），再调用 `find_rems_by_reference` 扩展直接/间接引用。
  - `timeRange` 支持 `"all"` 或 `"*"` 表示不限制时间范围。
  - 对文本命中与引用命中合并去重后，调用 `outline_rem_subtree`（支持 `maxNodes` 分页）生成 Markdown；默认响应包含聚合 Markdown、`highlights`（精简条目：`remId/title/matchedBy/anchorIds`）以及 `referenceIndex`，帮助代理继续沿引用链探索。
  - 支持 `groupBy`（按顶级父节点、日期或不分组）、`maxResults`、`includeReferenceMatches`、`referenceDepth`、`maxReferenceCandidates` 等参数；结果中给出 `filtersApplied` 与引用命中统计。
  - `detail=true` 时附带完整 `items`/`groups`（含 Markdown 子树、节点统计、引用层级等），供深度调试使用。
  - 若引用阶段无结果，会提示可提升 `referenceDepth` 或指定锚点；同时返回 `referenceDepthUsed`、`referenceDepthAttempts`，供代理决定是否递增搜索范围。
- **用途**：生成某主题的时间段总结，优先级高于 `summarize_daily_notes`，覆盖文本与引用双重关联。

### 9. `list_rem_backups`（可选）
- **意图**：列出 `~/remnote/<env>/backups/` 中的数据库备份，方便切换数据源。
- **实现要点**：
  - 读取目录、返回文件名、创建时间、大小。
  - 可与工具参数结合，选择读取某个备份（例如设置 sqlite 路由到备份文件）。

## 工具协作流程示例
1. **定位并查看笔记**：
   - `search_rem_overview` 关键词 `"2025/10/10"` → 获得 `FuXlIeNEdqGlmV9Fn`，若有更多结果通过 `nextOffset` 翻页。
   - `outline_rem_subtree` 展开该 ID（必要时利用 `startOffset`、`maxNodes` 分批读取）。
   - 对局部详情使用 `inspect_rem_doc` 或 `resolve_rem_reference`。
2. **调试引用**：
   - `inspect_rem_doc` 发现 `key` 中存在 `{"i":"q","_id":"..."}`。
   - 调用 `resolve_rem_reference` 获取引用 Rem 文本。
3. **批量导出**：
   - `search_rem_overview` 按标签或关键词匹配 Rem，策略性分页。
   - 逐个 `outline_rem_subtree`（根据节点量分页）→ 生成结构化输出。
4. **专题活动总结**：
   - `search_rem_overview query="rust"` → 识别锚点 Rem ID，并在需要时传递至后续请求的 `referenceIds`。
   - `summarize_topic_activity keywords=["rust"] timeRange="30d" includeReferenceMatches=true referenceDepth=2` → 汇总最近一个月的文本与引用命中。
   - 若需要扩展更多隐含关联，可单独调用 `find_rems_by_reference targetIds=[...]`，并结合 `outline_rem_subtree` 深入阅读某条目。
5. **每日笔记周报**：
   - `summarize_daily_notes` 汇总最近一周，查看 `truncated=true` 的日期。
   - 针对需要深挖的日期，继续调用 `outline_rem_subtree id=<remId> startOffset=<maxLines>`。

## 输入输出建议
- 所有工具需支持配置数据库路径；默认应在 `~/remnote/` 下扫描 `remnote-<accountId>/remnote.db`，根据目录最近修改时间选择当前主库，并允许切换至备份。
- 输出统一采用 JSON，便于上层 LLM 后处理；在需要阅读性时可附加 Markdown 文本。
- 对于深层递归操作，应设置默认深度限制，避免遍历过大树。
- 错误处理要明确：Rem 不存在、引用缺失、sqlite 执行失败等返回标准错误码。

## 实施注意事项
- `remsContents` 的 FTS5 查询依赖 RemNote 自带扩展；若在本地运行环境中无法加载，只能退回 `remsSearchInfos` 的 JSON 字段匹配。工具在 FTS 失败时会返回中文提示，并建议改用 `mode="like"` 或默认 `auto`。
- 注意防止循环引用或过深的引用层级；`resolve_rem_reference` 需跟踪已访问节点。
- `find_rems_by_reference` 默认为单层扩展，若提高 `maxDepth` 需配合 `maxCandidates` 控制规模，并在实现中维护已访问集合防止循环。
- 对于空 `key` Rem 要做额外标识，避免误判。
- 后续若要读取卡片/同步信息，可追加类似 `inspect_card_doc`、`list_pending_recompute` 等工具。

## 错误与排错
- 数据库被占用/无法打开：报 `无法打开数据库 ...（可能正在被 RemNote 客户端占用或尚未写入完成）`。处理：等待同步完成或稍后重试；如需立即使用，可改用备份路径 `dbPath=...`。
- 缺少索引表：报 `数据库缺少搜索索引表 remsSearchInfos/remsContents`。处理：在 RemNote 客户端完成索引（或使用较新的备份）。
- 缺少主表：报 `数据库结构不匹配（缺少 quanta 表）`。处理：确认 `dbPath` 是否指向 RemNote 的 `remnote.db`，并位于正确账户目录。
- FTS 不可用：报 `全文检索 FTS 当前不可用...`。处理：将 `mode` 设置为 `"like"` 或省略 `mode` 交给 `auto` 回退。
- 参数校验：常见为 `query 必填`、`id 必填`、`ids 必填，至少 1 个`、`timeRange 需形如 '30d'`；若需不限制时间窗口，可传 `"all"` 或 `"*"`。

## 后续工作
1. 确认本地运行环境能够访问 sqlite 文件（权限与路径）。
2. 选择合适的 sqlite 访问方案（原生 `sqlite3`、Python `sqlite3`、Node `better-sqlite3` 等）。
3. 针对每个工具编写具体 SQL 以及结果整形逻辑，确保格式稳定。
4. 编写 README / 入门文档，说明如何配置数据库路径、常见用例。
5. 持续关注 RemNote 更新，必要时刷新 `database-notes.md` 中的结构描述。
- **新增**：`summarize_daily_notes`
  - 汇总最近 N 天每日笔记，自动根据用户的日期格式匹配 Rem。
  - 调用 `search_rem_overview` + `outline_rem_subtree` 获得 Markdown 摘要；默认返回聚合 Markdown、`daysSummary`（逐日精简状态）与 `referenceIndex`，每篇受 `maxLines` 限制并标记 `truncated`。
  - 如需继续阅读被截断的内容，可结合 `outline_rem_subtree id=<remId> startOffset=<maxLines>` 继续分页；`detail=true` 时额外携带逐日 `results`（含节点列表），便于调试引用细节。
  - 仅在用户明确要求按日期浏览每日笔记时调用；存在关键词+时间窗口的问题时，应优先考虑 `summarize_topic_activity`。
  - `summarize_topic_activity` 默认会加载引用命中，如需单独调试引用，可使用 `find_rems_by_reference`。
- **协作指引**：该工具适合轻量即时查找；当需要组合条件或减少多次调用时，应切换为 `build_search_query → execute_search_query`。
- **注意事项**：此链路是通用检索入口，默认优先于 `search_rem_overview`。除非仅需一次简单关键词查找，否则建议使用此方案以减少后续调用次数。

## 新增：`list_todos`
- 意图：高频待办一键查询。内置解析个人常用任务标签（如“待办”/“Todo”/“TODO”/“Tasks”等），直接定位表格的 `Status` 选择列与 `Unfinished/Finished` 选项，以及 `Due/Due Date` 截止日列；一次调用完成识别 → 命中 → 排序 → 分页，避免多工具链反复调用。
- 核心机制：
  - 通过标签标题精确匹配表头 Tag（`quanta.doc.key[0]`）。
  - 解析属性/选项（与 `read_table_rem` 思路一致）：属性 Rem 的 `rcrs` 判定类型，选项 Rem 的 `pd` 字段提供“选项→行”反向映射，直接得到 Status=Unfinished 的所有行 Rem ID。
  - 元信息一次性批量获取：从 `remsSearchInfos`/`quanta` 取文本、祖先路径、时间戳。
  - 排序：若存在 `Due` 列，则按截止日升序（解析日期引用 Rem 得到时间戳）；否则按 `updatedAt` 降序。
  - 范围：支持 `ancestorId` + `includeDescendants` 过滤仅某子树内的任务。
- 入参（要点）：
  - `status`: `unfinished|finished|all`（默认 `unfinished`）
  - `tagIds?` / `tagTitles?`（默认内置别名）
  - `ancestorId?` / `includeDescendants?`（默认 true）
  - `statusAttrTitles?`（默认 `Status/状态`）、`unfinishedOptionTitles?`（默认 `Unfinished/未完成`）、`finishedOptionTitles?`（默认 `Finished/已完成/Done/完成`）、`dueDateAttrTitles?`（默认 `Due/Due Date/截止/到期`）
  - `dueAfter?` / `dueBefore?`：截止日上下界（ISO/时间戳，支持 `today|yesterday|tomorrow` 简写）
- `sort?`: `dueAsc|dueDesc|updatedAtAsc|updatedAtDesc`（默认 `updatedAtDesc` 最新在前）
- `limit/offset/snippetLength`
- `includeTagOnlyWhenNoStatus`：仅 `status=all` 时生效，允许纳入没有状态列、仅打标签的任务。
- `preferTodoFirst?`：是否优先置顶 `Todo/TODO` 标签结果（默认 false）。
- 输出：
  - `items[]`: `{ id, title, snippet, truncated, ancestor, ancestorIds, parentId, updatedAt, createdAt, source: "table"|"tag-only", tagId }`
  - `usedSchemas[]`: `{ tagId, tagName, statusAttrId?, unfinishedOptionId?, finishedOptionId?, dueDateAttrId? }`
  - `hasMore/nextOffset/guidance/suggestions`
- 何时使用：
  - 日常“未完成/到期/范围/排序”一把梭 → `list_todos`。
  - 复杂多条件（负责人、优先级、跨表） → `build_search_query → execute_search_query`。
