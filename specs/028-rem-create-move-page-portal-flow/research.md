# Research: 028-rem-create-move-page-portal-flow

日期：2026-03-20  
Spec：`specs/028-rem-create-move-page-portal-flow/spec.md`

## 背景结论

用户的核心工作流不是“默认把内容写成 page”，而是：

- 默认把 agent 写入落到当日 DN，作为 playground
- 当内容值得沉淀时，显式执行 create / move promotion flow
- durable content 与 portal 关联一步完成

因此这次特性必须满足三个现实约束：

1. 不新增 workflow noun，继续留在 `rem create` / `rem move`
2. 对 agent 暴露稳定、可组合的参数语义，而不是“场景特化命令”
3. 外层命令最终要收敛到同一个 canonical internal plan surface，而不是各自偷偷执行一套 runtime 分支

## 决策

### D1. 不新增 `page` / `elevate` 命令族

原因：

- page 只是“特殊的 Rem”，不应单独拉一层 noun
- 用户明确偏好 agent-oriented composable CLI
- 仓库已有 `rem create` / `rem move` / `portal create` 原语，可承接能力扩展

结论：

- 只增强 `rem create`
- 只增强 `rem move`

### D2. `rem create` 不只支持新文本，也支持既有 Rem 作为 source

现状：

- `rem create` 只有 `--text`
- 结构化内容写入主要走 `daily write --markdown` 或 `rem children * --markdown`

问题：

- direct-create durable page 需要“一次命令”支持 title + markdown + optional portal
- 如果已有 Rem 需要先进入一个新 destination，目前必须额外再用一次 move

结论：

- `rem create` 新增 `--markdown <input-spec>`
- `rem create` 新增 repeated `--target <ref>`
- `rem create` 从“单一 `create_rem` wrapper”升级为“create destination + populate source content + optional portal insertion”的高层原子命令

### D3. 内容来源模型从三选一升级为四选一

结论：

- `--text`
- `--markdown`
- repeated `--target`
- `--from-selection`

内部模型：

- `text`
- `markdown`
- `targets[]`

规则：

- `--from-selection` 只是把当前 UI 选择解析成 `targets[]` 的 sugar
- `--target` 与 `--from-selection` 互斥
- `--target` / `--from-selection` 与 `--text` / `--markdown` 互斥

### D4. 标题规则按 source 类型区分

结论：

- `rem create --markdown` 必须显式提供 `--title`
- `rem create --target`：
  - 单 target 可缺省 `--title`，默认沿用 source Rem 文本
  - 多 target 必须 `--title`
- `rem create --from-selection`：
  - 单 root 可缺省 `--title`，默认沿用 source root 文本
  - 多 root 必须 `--title`

补充：

- `--markdown` 不要求 single-root；destination 自己就是稳定单根

### D5. 内容位置必须显式，缺省报错

用户裁决：

- 无位置参数不应默认为 top-level
- 应 fail-fast，并引导 agent 提供明确位置

结论：

- 内容位置四选一：
  - `--parent`
  - `--before`
  - `--after`
  - `--standalone`

### D6. `--is-document` 保持显式，默认 false

结论：

- `--standalone` 只表示无 parent
- `--is-document` 仍然显式控制 page/document 语义
- 默认必须保持 `false`
- `rem move --standalone` 不自动升级成 page
- `rem create --standalone` 也不自动升级成 page

### D7. portal 位置模型与内容位置模型平行

结论：

- `--portal-parent`
- `--portal-before`
- `--portal-after`

原因：

- 和 `--parent / --before / --after` 语义平行
- 对 agent 更好学

补充：

- `rem move` 的“原地留 portal”保留 shorthand：`--leave-portal`
- `rem create --from-selection` 的“原地留 portal”保留 shorthand：`--leave-portal-in-place`
- 第一版不把 `--leave-portal-in-place` 扩展到任意 explicit multi-target source

### D8. `rem move` 保持“单对象重定位”，不承担通用 batch move

原因：

- `rem move` 的自然语义是“重定位一个已有 Rem”
- 一旦引入多对象 move，再叠加 leave-portal / in-place，复杂度会快速上升
- 多个已有 Rem 进入一个新 destination，更自然的是 `rem create --target ...`

结论：

- `rem move` 继续只接受单 `--rem`
- 多对象来源统一交给 `rem create --target ...` 或 `--from-selection`

### D9. 允许半成品，但 receipt 必须强

用户裁决：

- content create/move 成功后，不应因为 portal 失败而强行回滚
- CLI 需要能把现状讲清楚

结论：

- 允许 partial success
- receipt 必须返回 durable target id
- 同时返回 warnings / nextActions / portal status

### D10. `apply` 是 canonical internal surface

结论：

- `portal create` / `rem create` / `rem move` 是 public semantic facades
- 它们都应先归一化为统一 intent
- 再编译到同一个 canonical internal plan surface
- 这个 internal plan surface 应与 `apply` actions/ops 兼容

原因：

- 统一 runtime 路径
- 避免不同命令各自偷藏一套 planner
- 便于 future batch 能力和 skill 路由统一

### D11. 不在本特性里引入 Effect Schema 全面迁移，但要引入 Effect-style intent layer

现状：

- CLI 参数解析依赖 `@effect/cli`
- 动态组合校验主要是 handler 中手写 imperative 校验
- 仓库当前基本没有 `effect/Schema` 用于 CLI 参数组合约束

结论：

- 本特性不做全仓 Schema 化
- 但必须把 create/move 的复杂组合校验集中到专用 normalize + validate 模块
- 完成实现后还要做一轮 Effect practice alignment review

## SDK / Runtime 可行性结论

- RemNote SDK 没有一条现成高层 API 能一步做完“create destination + import targets/markdown + place portal”
- 但现有 primitive 足够组合实现：
  - create Rem
  - move Rems
  - set document
  - create portal
  - attach portal target

因此本特性本质上是：

- CLI contract 扩展
- planner / apply 编排
- plugin composite execution
- receipt / diagnostics 设计

## 对实现的影响

### `rem create`

需要支持：

- `--markdown`
- repeated `--target`
- `--from-selection`
- `--standalone`
- `--portal-parent/before/after`

### `rem move`

需要支持：

- `--standalone`
- `--before/after`
- `--leave-portal`
- optional `--is-document`

### shared planner

需要支持：

- source normalize to `text | markdown | targets[]`
- placement normalize to `parent | before | after | standalone`
- portal placement normalize to `none | parent | before | after | in_place`
- compile to one canonical `apply`-compatible plan

### receipt

至少需要稳定暴露：

- durable target id
- moved/created ids
- portal id
- source anchor context
- warnings
- nextActions
