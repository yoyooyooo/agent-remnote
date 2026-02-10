# RemNote 本地搜索索引层抽样调查（`remsSearchInfos` / `remsContents`）

> 目的：把 RemNote 本地 DB 的“搜索索引层”摸清楚，便于在**只读**前提下做更稳定、可控、可分页的检索与汇总。
>
> 说明：本文是对一份本机 `remnote.db` 的只读抽样记录；不同 RemNote 版本可能变更字段/触发器/索引，结论以你当前 DB 为准。

## 结论先行

1. **`remsSearchInfos` 是可直接利用的“派生索引视图”**：包含 `kt/ke/p/rd` 等搜索与结构相关字段，并维护了 `ancestor_*` 缓存文本（祖先链摘要）。
2. **`remsContents`（FTS5）在外部 sqlite 环境通常不可用**：该库使用 `tokenize='simple'`，系统 `sqlite3` 会报 `no such tokenizer: simple`，这意味着在 CLI/服务端环境里经常只能回退到 `remsSearchInfos` 的 LIKE/JSON 查询策略。
3. **即使 FTS 不可用，`remsContents_*` 底层表仍可读**：尤其是 `remsContents_content(c0)` 里有“分词后的内容”（例如中文会被空格切分），可用于排查/理解，但不建议作为主要检索路径（容易退化成全表扫描）。

## 抽样方法（可复现）

- 只读打开：`sqlite3 -readonly <dbPath> "<SQL>"`
- 为避免卡住，建议：`timeout 10s sqlite3 -readonly <dbPath> "<SQL>"`
- DB 位置通常在：`~/remnote/remnote-<accountId>/remnote.db`（也可能存在 `~/remnote/remnote-browser/remnote.db` 等变体）

## 相关表与 DDL（抽样库）

### `remsSearchInfos`

抽样库中的 DDL（来自 `sqlite_master`）：

```sql
CREATE TABLE remsSearchInfos(
  ftsRowId INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  aliasId TEXT NOT NULL,
  id TEXT NOT NULL,
  doc TEXT NOT NULL,
  freqCounter REAL NOT NULL,
  freqTime REAL NOT NULL,
  ancestor_not_ref_text,
  ancestor_ref_text,
  ancestor_ids
)
```

- `ftsRowId`：与 FTS 层（`remsContents` / `remsContents_content`）的 rowid 对应。
- `id`：Rem ID（多数情况下与 `aliasId` 相同，但抽样库中确实存在 `aliasId != id` 的行）。
- `doc`：JSON（扁平化的派生字段，下面专门列）。
- `ancestor_*`：由触发器维护的祖先链缓存（文本与 id 链）。

索引（抽样库）：

```sql
CREATE UNIQUE INDEX idx_search_info_alias_id ON remsSearchInfos(aliasId, id);
CREATE INDEX idx_search_info_id ON remsSearchInfos(id);
CREATE INDEX remsSearchInfos_id ON remsSearchInfos(id);
CREATE INDEX idx_remsSearchInfos_ancestor_ids_rowid ON remsSearchInfos(ancestor_ids, ftsRowId);
CREATE INDEX json_remsSearchInfos_p ON remsSearchInfos(JSON_EXTRACT(doc, '$.p'));
```

可直接利用的点：

- `json_remsSearchInfos_p`：当你需要 “限定 parentId / 子树范围” 时，尽量使用字面一致的表达式 `JSON_EXTRACT(doc,'$.p')`（或 `json_extract` 同形态）以命中该索引。

### `remsSearchRanks`

```sql
CREATE TABLE remsSearchRanks(
  ftsRowId INTEGER NOT NULL PRIMARY KEY,
  rank INTEGER NOT NULL
) WITHOUT ROWID
```

它由触发器维护（见下文），用于给搜索结果提供更贴近 RemNote 的排序权重。

### `remsContents`（FTS5）

```sql
CREATE VIRTUAL TABLE remsContents USING FTS5(data, tokenize = 'simple', prefix = '1 2 3')
```

抽样结论：

- 系统 `sqlite3` 直接查询 `remsContents` 会失败：`no such tokenizer: simple`。
- 这通常意味着：在**非 RemNote 桌面端自带的 sqlite 环境**中，`MATCH` 查询大概率不可用（服务端/CLI 环境需要默认回退策略）。

### `remsContents_*`（FTS 的底层表）

即使 `remsContents` 不可用，底层表仍可直接读取：

- `remsContents_content(id INTEGER PRIMARY KEY, c0)`
- `remsContents_idx(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID`
- `remsContents_data` / `remsContents_docsize` / `remsContents_config`

抽样观察：

- 可通过 `remsSearchInfos.ftsRowId = remsContents_content.id` 做 join。
- `remsContents_content.c0` 看起来是“分词后的内容”，例如：
  - 英文：`workspace`
  - 中文：`新 手 引 导`（字符间空格）

## 触发器：索引是如何被维护的

抽样库中，以下触发器与搜索索引层直接相关：

- `addRemsSearchRanksOnInsert` / `addRemsSearchRanksOnUpdate` / `addRemsSearchRanksOnDelete`
  - 负责维护 `remsSearchRanks(rank)`
  - rank 的计算依赖 `remsSearchInfos.doc` 里的字段：`w/wl/i/rd/y/t/u/tc/x/k` 等
- `remsSearchInfosRecursiveInsert` / `remsSearchInfosRecursiveUpdateParent` / `remsSearchInfosRecursiveUpdateText`
  - 负责维护 `ancestor_not_ref_text` / `ancestor_ref_text` / `ancestor_ids`
  - 祖先链依赖 `doc.$.p`（parent id）与 `doc.$.kt/ke`
- `deleteSearchInfoOnQuantaDelete`
  - 当 `quanta` 删除时，会联动删除 `pendingRecomputeRems`、`remsSearchInfos` 以及尝试删除 `remsContents` 对应 row

这意味着：`remsSearchInfos` 不是随便堆出来的表，而是 RemNote 持续维护的“可用索引层”，适合用来做“快速定位 + 轻量过滤”。

## `remsSearchInfos.doc` 的字段形状（抽样）

通过对 `remsSearchInfos` 前 2000 行的 `json_each(doc)` 统计，字段出现频率大致分两类：

- **几乎必有（2000/2000）**：`_id a c d fl g h i ic k ke kt l m r rd s st t v ve vt w wl x`
- **常见但非必有**：
  - `p`（1917/2000）：父节点 id（在“根/顶层”或特殊节点上可能缺失）
  - `u`（171/2000）、`y`（141/2000）、`pc`（110/2000）、`tc`（41/2000）、`e`（11/2000）

已知/可确认的语义（以 DB 触发器与仓库文档为依据）：

- `kt`：无引用文本（not ref text）
- `ke`：含引用文本（ref text）
- `p`：parent id（用于递归维护 `ancestor_*`）
- `rd`：层级深度（本仓库代码用它识别 Page：`rd=1`）
- `w/wl/i/rd/y/t/u/tc/x/k`：用于计算 `remsSearchRanks.rank`（权重公式由 trigger 固化）

其余字段（如 `a/c/r/st/...`）在抽样层面仅能确认其“存在且被 RemNote 维护”，但含义需要结合 RemNote 版本与更多样本再做归因；建议以“可用于排序/过滤的稳定字段”优先：`kt/ke/p/rd`。

## `quanta` 与可用索引（与搜索结合）

`quanta` 是最终真相源：`(_id TEXT PRIMARY KEY, doc TEXT, x INTEGER)`。

抽样库中，`quanta` 存在大量 JSON 表达式索引（节选）：

- `json_quanta_parent`：`JSON_EXTRACT(doc, '$.parent')`
- `json_quanta_p`：`JSON_EXTRACT(doc, '$.p')`
- `json_quanta_k`：`JSON_EXTRACT(doc, '$.k')`
- `json_quanta_rcrs` / `json_quanta_rcre`：用于属性/选项等结构节点定位
- 其它：`json_quanta_m/json_quanta_o/json_quanta_y/...`

对本仓库“先索引、后 quanta 深挖”的意义：

- 先用 `remsSearchInfos` 找到候选 Rem（尤其当你只需要标题/摘要/父链/深度时，不必立刻读 `quanta.doc`）
- 真要解析结构/属性/引用时，再按需查询 `quanta`（并尽量命中已有 JSON 表达式索引）

## 对本仓库工具设计的直接启示（建议）

1. **把 `remsSearchInfos` 作为默认入口**：能不读 `quanta.doc` 就先不读；把 `quanta` 留给“点开详情/展开大纲/属性解析”。
2. **FTS 当作“可选加速”而不是依赖**：因为 tokenizer 绑定 RemNote 环境，外部大概率不可用；因此要有稳定的 fallback（LIKE/限定 parentId/timeRange/分页）。
3. **遇到“组合条件”优先做候选集收敛**：先用能命中索引的条件（如 parentId、深度、时间窗口等）把候选缩到可控规模，再做更重的 JSON 解析/过滤，避免扫全库。

