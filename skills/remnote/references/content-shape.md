# Content Shape

只在这些情况加载本文件：

- 需要判断内容是否适合写成大纲
- 需要决定单根 / 多根、bundle / 非 bundle
- 需要写 Daily Note、扩写现有 Rem、或修 parent
- 需要处理引用和 portal 的结构语义

## Outline Suitability

默认先做一次智能判断：

- 如果内容满足下面的标准，优先整理成分层大纲
- 如果内容不满足，保留正常写法，不要为了规整强行拆树

### 判断标准

- 节点可独立阅读
- 层级关系明确
- 同层语义同构
- 可继续展开

### 适合直接写成大纲的内容

- 分类说明
- 分步骤流程
- 调研结论
- 对比分析
- 结构化知识卡片
- 会议纪要
- 总结与复盘

### 不适合直接写成大纲的内容

- 强依赖上下文的连续论证文本
- 修辞性很强的长段散文
- 缺失任何一段就不连贯的链式推导

### 转换策略

- 连续论证文本先重写为“问题 / 假设 / 推导 / 结论 / 证据”之类结构，再入库
- 长段叙述先抽主题句，再把细节下沉成子级

## Outline Shape Rules

### 报告型内容

- 默认只有一个顶层根节点
- 二级节点写主题块
- 三级节点写原子结论

### 扩写型内容

- 保留现有标题 Rem 作为锚点
- 默认重写这个 Rem 的 direct children，不要在页面根下新建并列节点

### 同层约束

- 不要在同一层同时放定义、问题、例子、步骤、结论
- 如果同层语义混乱，先重组结构，再写入

## DN Rule

DN 最容易写错的是 parent。

如果用户说“写到今天这条日记下面”，注意区分：

- `Daily Document` 容器页
- 当天 `YYYY/MM/DD` 那条 Rem

如果需要拿当天条目 Rem ID：

```bash
agent-remnote --ids daily rem-id
```

只有在用户要写到当天条目下的某个具体 section 时，才继续用 `rem children ...`。

## Markdown Input Rules

所有结构化写入优先：

```bash
--markdown -
```

也支持：

- inline：`--markdown $'- a\n  - b'`
- file：`--markdown @./note.md`

默认推荐 `--markdown -`。

## Markdown Shape Contract

- 报告型内容默认只有一个顶层 bullet
- 顶层 bullet 下再展开二级和三级
- 单个 bullet 应表达一个完整意思
- 链接优先用 Markdown 链接语法
- 如果内容不适合大纲化，不要强行改成“一个根下面很多半成品子项”

## Daily Note 写入裁决

- 用户只是说“写到今天日记里”，优先 `daily write`
- 捕获型：几条碎片信息，可允许多个根节点
- 报告型：必须单根，默认 `daily write --markdown ... --bulk never`
- 扩写型：不要写 DN 根，优先改写现有 Rem 的 children
- 如果 Markdown 本身已经表达了单一主线结构，不要再额外包一层容器式根节点

## References and Portals

引用优先级：

- `((RID))`
- `{ref:RID}`

不要默认依赖标题引用。

Portal 不是 Reference。

插 Portal 时用：

```bash
agent-remnote --json portal create --to "id:<targetRemId>" --at "parent:id:<parentRemId>"
```
