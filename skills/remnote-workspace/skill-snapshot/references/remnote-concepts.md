# RemNote 概念补充（给 Agent 的最小模型）

本文件用于在“写入/导入/组织结构/双链”场景下，避免把 RemNote 误解成“普通 Markdown 文档”或“文件系统笔记”。不需要全文加载；按需查阅对应段落。

## 1) Rem / RemId

- **Rem**：你在 RemNote 里看到的一行内容（一个块/节点）。
- **remId**：每个 Rem 的稳定标识（字符串）。所有写入与引用最终都要落到具体 `remId`。
- **父子关系（大纲树）**：每个 Rem（除根节点/页面根）都有 `parentId`；同一 parent 下按顺序排列。

## 2) Page（页面）

- Page 也是 Rem（仍然有 `remId`），只是 UI 上作为“页面/文档入口”呈现。
- “在某个页面下追加内容”本质：找到该 Page 的 `remId`，再向其子树追加 Rem。
- CLI 通常通过 `--ref page:<标题>`（或显式 `--parent <remId>`）来定位写入目标。

## 2.1) Daily Note（每日笔记）

- Daily Note 是 RemNote 的“按日期组织的页面”，本质仍然是一个 Page（Rem）。
- 本项目里：
  - 写入：`agent-remnote daily write ...`
  - 查询（按内容/结构）：`agent-remnote read outline --ref daily:today ...`

## 3) 富文本（Rich Text）与 Markdown

- Rem 内容不是“纯文本字符串”，而是富文本结构：可包含加粗、代码、链接、标签、内部引用等。
- 在本项目里，CLI 的 `write md`/`create_tree_with_markdown` 走的是“Markdown → 插件侧 API → 富文本”转换路径：
  - 这意味着 Markdown 只是输入格式，不代表 RemNote 内部存储就是 Markdown。
  - 若需要“精确保真”的富文本结构（例如复杂表格/嵌入），通常要调整 op 类型或在插件侧实现更强的转换策略。

## 4) 双链（引用 / Backlinks）≠ 父子结构

- **父子结构**：决定大纲层级与折叠展开（树）。
- **引用/被引用（双链）**：决定“链接关系”（图），与父子结构无关。
- 用户说“建立双链/引用”时，通常不是“移动到某个 parent”，而是“创建 link rem / 插入引用”。

## 4.1) Pane / Portal / Focus / Selection（与 UI 上下文挂钩）

> 这些概念用于理解 `uiContext` 与 `selection` 快照，避免把 UI 运行态误当成 DB 可推导信息。

- **Pane（窗格）**：RemNote 可以多窗格并行编辑；`paneId` 表示当前聚焦窗格。
- **Portal（视图实例/投影容器）**：
  - 同一个 Rem（或其子树）可能同时出现在多个地方（例如嵌入/投影/引用视图）。
  - `focusedPortalId` 用来区分“焦点 Rem 当前是在哪个视图实例里被编辑的”。
- **focusedRemId**：光标所在 Rem（通常是单个）。
- **selection**：用户选中的 Rem 集合（可能多选；与 focusedRemId 不必相同）。
- **pageRemId**：当前窗格打开的 Page Rem ID（回答“用户当前处在哪个页面”最关键的 ID）。

## 5) Agent 写入时的常见误区（避免）

- 把“Rem”当成“段落”或“行文本”直接拼接：实际应以“节点追加/插入”的方式操作。
- 忽略 `parentId`：创建类写入必须指定父节点，否则会生成不可控的孤儿节点（本项目已在入队侧做校验）。
- 以为“写入后立刻可见”：本项目写入链路是“队列 →（可选）WS 通知 → 插件执行”；若用户要求即时可见，需要确保 `agent-remnote daemon` 运行且插件已连接。

## 6) UI Context 的三种获取方式（建议优先级）

1. **插件事件推送（UI Push）**：最真实，来自用户交互；经 WS bridge 写入 state file。
2. **读 state file（最后快照）**：`~/.agent-remnote/ws.bridge.state.json`；注意 staleness。
3. **DB 只读查询（DB Pull）**：只能补全内容/结构，不能直接得知“当前页面/焦点/选择”。
