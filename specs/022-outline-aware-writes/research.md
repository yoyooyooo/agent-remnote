# 研究记录：022-outline-aware-writes

## 1. 为什么需要“内容形态判断”

当前问题不只是命令太底层，更是系统默认把“所有结构化 Markdown”都当成适合大纲化的内容。

但实际上存在两类完全不同的写入材料：

- 天然适合大纲化的内容
  - 分类说明
  - 调研结论
  - 会议纪要
  - 由浅入深的总结
- 不适合直接大纲化的内容
  - 连续论证
  - 修辞性强的段落
  - 依赖上下文补完的长句链

结论：

- “单根大纲化”应是偏好，不是强制
- 系统需要显式支持正常写法

## 2. 为什么高层场景判断不该进入公开 CLI

只靠 Skill 约束不够，因为 CLI 还需要保证结构结果。

但把 `intent`、`shape`、`expand` 这类概念直接公开成 CLI，也有明显问题：

- 它们更像 Agent 的内部推理结果，而不是基础执行原语
- 会让 CLI 面快速场景化、膨胀
- 后面很容易继续长出更多“场景型命令”

结论：

- Skill 负责路由与语义判断
- CLI 负责目标选择、backup 策略、结构断言

## 3. 为什么不应该新增 `rem expand`

“扩写当前选中 Rem”确实是高频场景，但它本质上还是：

- 找到目标 Rem
- 保留 anchor
- 重写其 children

如果为它单独新增 `rem expand`：

- 命令面会更贴近场景
- 但会削弱“原子能力优先”的设计方向

更合理的方式是增强现有命令：

- `rem children replace --selection`
- `--assert preserve-anchor`
- `replace markdown` 保留为 local-only 的块级替换 escape hatch

这样 Agent 仍能走最短路径，CLI 也不必引入新的场景型命令，同时不会把 block-range replace 和 expand-in-place 写成双主路径。

结论：

- 不新增公开 `rem expand`
- 用 `rem children replace` 作为默认 expand-in-place 路径
- `replace markdown` 只保留为 advanced/local-only 的块级替换入口

## 4. 为什么 backup 不该默认可见

当前 replace 类 backup 的本意是应用层补偿事务：

- 先把旧内容转移到临时区
- 再提交新内容
- 失败时回滚

它不是面向用户的“历史版本功能”。

一旦 backup Rem 进入用户可见知识树，就会有三个问题：

- 污染结构
- 增加认知噪音
- 让内部实现细节泄漏到用户面

结论：

- 默认成功路径不应留下可见 backup

## 5. 为什么仍然需要 backup 治理能力

即使默认不保留 backup，现实里仍可能因为：

- 插件异常
- 删除失败
- move 回滚失败
- 命令中断

导致 backup Rem 残留。

如果没有统一治理面，残留 backup 只能靠人工搜索文本标题来清理，成本太高。

结论：

- 需要 `backup list`
- 需要 `backup cleanup`
- 需要统一的 PowerUp / Tag 标记
- 需要 Store DB registry 做真相源

## 6. 为什么“Store DB 为真相源，PowerUp 为索引”是更优解

只用 PowerUp 的问题：

- 打标可能失败
- 只看 UI 状态无法知道对应事务是否已终态
- cleanup 决策不够可靠

只用 Store DB 的问题：

- 用户在 RemNote 里看不到哪些节点是 backup
- 人工清理和排查不方便

混合方案的好处：

- Store DB 负责 lifecycle truth
- PowerUp 提供 UI 内的可见抓手
- CLI 命令统一消费两侧信息

结论：

- 这是当前最平衡的设计

## 7. PowerUp 命名为什么用 `agent-remnote backup`

用户已经明确要求内部 PowerUp 统一使用 `agent-remnote` 前缀。

这样做的好处：

- 与用户自己业务语义的 PowerUp 区分清楚
- 后续新增内部 PowerUp 时具备稳定命名空间
- 搜索、过滤、清理都更直观

结论：

- 本轮固定使用 `agent-remnote backup`

## 8. 是否需要“不可见长期 backup”

不建议在当前阶段默认引入。

原因：

- 它会形成新的隐形孤儿
- 清理更难
- 调试也更难

如果后续需要长期恢复点，更适合单独设计一套 snapshot / retention 机制，而不是塞进当前 replace 补偿链路里。

结论：

- 当前阶段只做显式、可治理的 backup artifact

## 9. 为什么 `backup list/cleanup` 仍然合理

这两个命令虽然看起来偏运维，但它们本质上还是基础能力：

- `list` 是 backup artifact 的枚举
- `cleanup` 是 orphan backup 的回收

它们没有引入额外的业务场景词，只是对 backup 这个底层对象提供读和清理能力。

结论：

- 它们仍符合“原子能力优先”的方向

## 10. 为什么 `--assert` 可以保留

`--assert` 确实是在“扩写当前选中 Rem”这类任务里被暴露出来的。

但它和 `--selection` 的角色不同：

- `--selection` 解决“写到哪”
- `--assert` 解决“写完后结果必须满足什么条件”

所以它不是单纯的 `--selection` 配件。

它仍然有独立价值：

- `rem children replace --rem <id> --assert single-root`
- `rem children replace --rem <id> --assert preserve-anchor`
- `rem children replace --rem <id> --assert no-literal-bullet`

这些都不依赖 `--selection`。

结论：

- `--assert` 应保留
- 但必须控制成一个很小的固定集合
- 第一版围绕 canonical `rem children replace` 路径定义即可，不需要把 `replace markdown` 提升为并列断言承载面

## 11. 为什么 `table` / `powerup` 双表面值得收紧

目前最明显的冗余之一，就是：

- `table record ...`
- `powerup record ...`

以及：

- `table option ...`
- `powerup option ...`

这类能力的对象语义高度重叠，但公开命令分成了两套表面。

对 Agent 的直接影响是：

- 同一件事要先选“走 table 还是走 powerup”
- 选择成本上升
- 最短路径搜索成本上升

结论：

- 需要指定一套主写入表面
- 当前更合理的是保留 `table` 为主写入面
- `powerup` 收缩到读侧发现和 schema 面
