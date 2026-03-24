# 契约：Query AST V2

日期：2026-03-22

## 目的

定义 031 的 canonical selector contract。

## 必需能力族

- tag
- powerup
- slot / attribute
- select / multi_select / date / text / number
- reference
- ids
- ancestor / descendant
- daily-range
- roots-only
- typed sort

## 已冻结的 canonical shape

- Query V2 保持“逻辑树 + 顶层 envelope”的分层。
- 顶层 envelope 可命名为 `QuerySelectorV2`；内部逻辑树可命名为 `QueryExprNodeV2`。
- 顶层 envelope 至少包含：`version`、`root`、`scope?`、`shape?`、`sort?`。
- `version` 在 031 的 canonical 输入中固定为 `2`。
- `scope` 是顶层 envelope 的一等区段，不混入 leaf predicate。
- 031 冻结的 runtime-ready `scope.kind` 最小集合为：
  - `all`
  - `ids`
  - `descendants`
  - `ancestors`
  - `daily_range`
- package authoring 若先通过 vars / preset / scaffold 产生非 runtime-ready 的 scope 形态，必须在执行前 normalize 到上述集合后，才能进入 selector execution 或 `/v1/read/query`。
- `reference` 是原子 predicate family，不提升为独立 scope wrapper。
- `roots_only` 是 selector modifier，属于 canonical query envelope。
- `ids` 是原子 predicate family，可与其他 predicates 组合。
- `powerup` 是原子 predicate family，但解析依赖宿主 authoritative metadata path。
- 031 冻结的 `powerup.by` 允许值只有：
  - `id`
  - `rcrt`
- Query V2 不接受 title / fuzzy / free-text powerup lookup；若调用方持有的是非 canonical powerup 标识，必须先经 host-authoritative metadata capability 规范化。
- `query --powerup <name>` 若存在，只属于 CLI / skill authoring sugar：
  - `name` 不进入 canonical Query V2
  - adapter 必须先把它规范化成 `id | rcrt`
  - 规范化失败时返回稳定错误，不做自由模糊匹配
- `sort` 保持 typed sort block，位于 canonical query envelope。
- normalize 后必须追加稳定 tie-break，避免 local / remote 排序漂移。

## Adapter / Migration Boundary

- 031 的 canonical Query V2 形态为：
  - `{ "version": 2, "root": ..., "scope?": ..., "shape?": ..., "sort?": ... }`
- legacy query 形态只允许停留在 adapter boundary：
  - CLI authoring sugar 组装出的 `{ query: { root: ... } }`
  - 现存 Host API wrapper 的 `queryObj`
  - 仅含 `{ root: ... }` 的过渡 payload
- adapter / normalizer 必须在进入 shared contract、host parity comparison、selector execution 前，把 legacy 输入提升为 canonical Query V2。
- 031 不允许把 legacy shape 继续写进 `SelectionSet`、`ScenarioExecutionPlanV1.selector_plan`、builtin preset 或 scenario package normalize 结果。

## Query / SelectionSet 分层

- `query` 读命令可以继续返回面向 CLI 的 preview items。
- `SelectionSet` 只承载编译与执行中间态所需的稳定事实，不直接继承 `query` 回执里的 `title/snippet/score/offset/nextOffset`。
- `SelectionSet.items[]` 在 031 只冻结最小必需投影 `rem_id`；更丰富的 per-item projected fields 暂不在 031 冻结。

## Shared / Host Boundary

shared contract 可承载：

- Query V2 schema types
- envelope / predicate normalization
- 静态字段校验
- sort / modifier 的 machine-readable shape

必须留在 host-authoritative runtime：

- workspace binding 与 DB 选择
- scope 展开
- powerup metadata 解析
- tag / powerup / slot / reference / ids predicate 求值
- SelectionSet materialization
- 依赖宿主 metadata 的 query rewrite

## 仍待后续细化

- `SelectionSet.items[].fields` 的最小 canonical projection
- 031 之后若要扩大 `scope.kind` 或 `powerup.by` 集合，必须先补 parity cases 与 migration rule，再扩 contract

## 不可妥协项

- local / remote selector semantics must match
- selector contract must remain independent from write-only plan shapes
