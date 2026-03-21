# Research: 029-write-command-surface-reset

日期：2026-03-21  
Spec：`specs/029-write-command-surface-reset/spec.md`

## 目标

确认 `029` 应该收口到什么程度，哪些概念要保留，哪些名字要删除，避免变成“旧参数换皮”的假统一。

## 现状盘点

### 1. 当前命令面的问题

- `rem create`
  - source、destination placement、portal placement、document flag 混在一起
  - source 既有 `--text/--markdown`，也有 repeated `--target` 与 `--from-selection`
- `rem move`
  - 主对象用 `--rem`
  - placement 用 `--parent/--ref/--before/--after/--standalone`
  - 原位 portal 用 `--leave-portal`
- `portal create`
  - 目标对象用 `--target`
  - portal 位置用 `--parent + optional --position`
- 其它单主体写命令
  - 大量还用 `--rem`
  - 少数命令还保留独立 `--ref`

### 2. 当前模型的优点

- `028` 已经把 create/move portal 语义统一到了 internal planner
- 原位 portal 的 runtime 语义已经存在
- `RefResolver` 已经具备值级 ref 解析能力

### 3. 当前模型的主要问题

- 参数名在“对象是谁”“关联谁”“放到哪”三个维度之间混杂
- `portal create` 与 `rem create` / `rem move` 缺少统一的接口级心智
- Agent 需要记住很多只对单个命令成立的 flag

## 设计选项

### Option A: 只收 `portal` 一族

结论：拒绝。收益不够大。

### Option B: 核心 write command 全量收口

结论：采用。

### Option C: 连 read surface 一起收

结论：拒绝。本轮只收 write surface。

## 决策记录

### D1. 这是显式 breaking change，不做兼容

原因：

- 用户已明确要求 forward-only reset
- 旧命令名与旧参数名本身就是负债
- 双表面会污染 skill / docs / contract tests

结论：

- 不保留 alias
- 不输出兼容告警
- old flags 直接报错

### D2. 保留多个语义维度，不做“全合一参数”

原因：

- `from` 与 `at` 解决的是不同问题
- `portal create` 还需要表达“指向谁”

结论：

- 需要稳定的五轴：`subject / from / to / at / portal`

### D3. `in-place` 取代 `source`

原因：

- `source` 与 content source 词面冲突太大
- 用户真正要表达的是“原位回填 portal”

结论：

- `--portal in-place` 取代 `--leave-portal` / `--leave-portal-in-place`
- 内部仍映射到 `in_place_single_rem` / `in_place_selection_range`

### D4. `portal create` 用 `to + at`

原因：

- 该命令的核心语义是“portal 指向谁、portal 插在哪”
- 若强行使用 `--subject`，会让角色语义漂移

结论：

- `portal create --to <ref> --at <placement-spec>`

### D5. `--subject` 只保留给 acted-on object

原因：

- 单主体命令的共同点是“有一个被直接操作的 Rem”

结论：

- `rem move`
- `rem set-text`
- `rem delete`
- `rem children *`
- `rem replace`
  统一使用 `--subject`

### D6. `--from` 只保留给 create source

原因：

- repeated `--from` 能清楚表达“多输入单输出”

结论：

- `rem create` 使用 `--from` / `--from-selection`
- repeated `--from` 的真实效果要在文档里写死：source rems 会被 move 到新 destination 下

### D7. `--to` 只保留给关系目标

原因：

- `portal create --to id:r1 --at after:id:r2` 一眼能看懂
- `--to` 不再混用为空间位置

结论：

- 当前 `029` 中，`--to` 主要服务 `portal create`
- 未来其它 relation-oriented commands 也可复用

### D8. 所有空间位置统一用 `--at`

原因：

- `at` 自然表达“插在哪 / 放到哪”
- 与 `to` 的“指向谁”语义不打架

结论：

- `rem create --at <placement-spec>`
- `rem move --at <placement-spec>`
- `portal create --at <placement-spec>`

### D9. placement grammar 改成 `parent[<position>]:<ref>`

原因：

- `parent:<ref>@<position>` 会和 ref 值里的 `@` 打架

结论：

- `standalone`
- `parent:<ref>`
- `parent[2]:<ref>`
- `before:<ref>`
- `after:<ref>`

### D10. explicit repeated `--from` 需要支持 `in-place`

原因：

- 自动化脚本常常已经拿到明确 rem ids
- 只允许 `--from-selection --portal in-place` 会逼脚本回退到 UI selection

结论：

- repeated `--from` 在满足“同 parent + contiguous range”时允许 `--portal in-place`
- 否则 fail-fast

### D11. 标题规则必须显式写死

原因：

- `rem create --text` / `--title` 组合最容易被 Agent 误解
- 单 `--from` 与多 `--from` 的标题推断策略必须稳定

结论：

- `--markdown` requires `--title`
- single `--from` MAY infer title
- repeated `--from` with multiple refs requires `--title`
- single-root `--from-selection` MAY infer title
- multi-root `--from-selection` requires `--title`
- `--text` without `--title` uses text as destination title
- `--text` with `--title` means title = destination title, text = first body child

### D12. 所有相关 CLI surface 都是 Agent-facing primitives

原因：

- 用户要的是可组合、可教学、原子化的 CLI
- “高层/低层”会把接口心智带偏

结论：

- `rem create`
- `rem move`
- `portal create`
- `rem set-text`
- `rem children *`
  都按 Agent-facing primitive 描述
- 真正的“低层”只保留给 runtime ops

### D13. read surface 暂不进入 029

原因：

- 本轮目标是“write 命令的组合心智”

结论：

- `029` 只收 write surface

## 结论

`029` 应当做一次完整 write surface reset：

- 命名统一
- 位置统一
- 关系目标统一
- docs / skill 一次同步
- CLI 术语统一到 Agent-facing primitive

如果只是局部修 portal flag，本轮的心智收益远远不够。
