# Iteration 2 Summary

## Goal

继续把 `skills/remnote/SKILL.md` 做成真正的渐进式披露入口，并用一组 `scenario` 行为评测检查结构重构是否影响路由稳定性。

## Structure Changes

### Main entry

- `skills/remnote/SKILL.md`: `785 -> 133` lines
- 现在只保留：
  - 核心目标
  - 硬约束
  - progressive disclosure 路由
  - `scenario` planned-surface 路由
  - parity authority

### Reference map

- `references/remnote-concepts.md`
- `references/content-shape.md`
- `references/scenario-surface.md`
- `references/runtime-ops.md`
- `references/remote-parity.md`
- `references/failure-recovery.md`
- `references/write-routes.md`
- `references/write-basic.md`
- `references/promotion-and-apply.md`
- `references/table-property-boundaries.md`

### Second-level disclosure

- `runtime-ops.md`: `179 -> 87` lines
- `write-routes.md`: `207 -> 36` lines

结论：

- 入口层已足够薄
- 第二层 reference 也从“大杂烩”变成“路由 + 细分 reference”

## Behavior Eval Set

本轮对比：

- `old_skill`: `skills/remnote-workspace/skill-snapshot`
- `with_skill`: 当前 `skills/remnote`

评测提示词：

1. `scenario-builtin-move-dry-run`
2. `scenario-user-file-explain`
3. `scenario-builtin-portal-dry-run`

## Behavior Eval Results

### Eval 1: builtin move dry-run

- `old_skill`: pass `5/5`
- `with_skill`: pass `5/5`

观察：

- 两版都能收敛到 `source_scope=daily:past-3d`
- 两版都先做 help / builtin discovery，再给 dry-run
- 新版更明确区分了“planned surface”与“真正执行”

### Eval 2: user file explain

- `old_skill`: pass `4/4`
- `with_skill`: pass `4/4`

观察：

- 两版都正确保持 `scenario schema explain` 在本地执行
- 新版回答更短，更少不必要补充

### Eval 3: builtin portal dry-run

- `old_skill`: pass `5/5`
- `with_skill`: pass `5/5`

观察：

- 两版都避免把 portal 需求错误降级成 move
- 新版更倾向于在当前构建缺少 `scenario` 子命令时显式提示“先停”，这一点更安全，但也更保守

## Quantitative Snapshot

以 Codex read-only isolated runs 的 wall clock 粗看：

- `old_skill` mean time ≈ `172.5s`
- `with_skill` mean time ≈ `204.6s`
- delta ≈ `+32.1s`

解释：

- 新版加载了更多分层 reference
- 行为更稳，说明更多，但有额外读取成本
- 这组数据更适合看“方向”，不适合当最终性能门槛

## What Improved

- 主入口明显更薄，第一次读取成本显著下降
- `scenario`、`remote parity`、`failure recovery`、`write routes` 都有了独立叙事边界
- 在 `scenario` 类问题上，新版更容易走出：
  - help-first
  - explain / list
  - dry-run before write

## Tradeoff

- 文档结构更清晰
- 行为更安全
- 代价是参考文档跳转增多，单次回答平均更慢

## Recommendation

当前结构已经达到“入口薄 + 细节按需加载”的目标。

接下来不应继续机械拆分。

更有价值的下一步是：

1. 给每个 reference 补“何时不要读我”的负例
2. 做一轮真正的 trigger eval，确认 description 和新的 reference 分层没有带来误触发或漏触发
