# Markdown 导入（Outline / 富文本）两条路径

## TL;DR

- `agent-remnote import markdown` 默认走 **native 模式**：插件端调用 RemNote SDK `plugin.rem.createTreeWithMarkdown`，由宿主解析 Markdown 并转成富文本；嵌套列表通常能得到多层级 Outline，但结构是否“包在某个父节点下”取决于 Markdown 的块结构（段落/列表/标题等）。
- `agent-remnote import markdown --mode indent` 走 **indent 模式**：插件端用自研 `importMarkdownByIndent` 按“前导空格缩进”建树，稳定得到无限层级 Outline；每一行会用 `createSingleRemWithMarkdown` 做“行级 Markdown → 富文本”解析（失败时降级为纯文本写入），但不会像 native 模式那样按 Markdown 块结构做完整导入（例如跨行段落合并）。
- `agent-remnote import markdown --staged`（可选）：视觉增强的 staged import（先写入到父级下的临时容器 Rem，最后一次性把根节点 move 到目标 parent），减少 UI 里“从父级一路往下逐个出现”的抖动；不改变导入语义，仅影响呈现方式。若最终 move 失败，会 best-effort 自动回滚（删除 staging 容器及其子树），避免留下过渡项/孤儿 Rem。
  - todo：`- [ ]` / `- [x]` 会被转换为 RemNote 的 todo 状态（不会把 `[ ]` 留在文本里）。
  - id 引用：`((<remId>))` / `((<remId>|<label>))` 会在导入后被修正为“按 RemId 的真实引用”（仅当该 id 存在且可访问），避免意外创建一个“名字=remId”的孤儿 Rem（native/indent 都支持）。
  - code fence：```lang 会写入 code 的 language（不会把 `lang` 作为代码正文第一行）。

## 1) indent 模式：按缩进建树（确定性）

- 入口：`create_tree_with_markdown`（不传 `indent_mode:false`）→ `packages/plugin/src/bridge/ops/handlers/markdownOps.ts` 的 `executeCreateTreeWithMarkdown`
- 实现：`packages/plugin/src/bridge/remnote/markdown.ts` 的 `importMarkdownByIndent`
- 语义：用“每级 N 个空格”（默认 `2`，可用 `indent_size` 覆盖）表示层级，逐行创建 Rem 并移动到对应 parent 下。
- 特点：Outline 结构稳定；每行文本优先走 `createSingleRemWithMarkdown`（行级解析富文本），失败才会降级为 `createRem + rem.setText(toRichText(string))`。

## 2) native 模式（默认）：RemNote 原生 Markdown 导入（富文本）

- 入口：`create_tree_with_markdown` + `indent_mode:false` → `packages/plugin/src/bridge/ops/handlers/markdownOps.ts` 的 `executeCreateTreeWithMarkdown`
- 实现：直接调用 `plugin.rem.createTreeWithMarkdown(markdown, parentId)`
- 特点：Markdown 由 RemNote 宿主解析，通常能得到链接/粗体/行内代码等富文本；嵌套列表一般会产生子层级。
- 常见“看起来像平铺”的原因：例如“先写一行普通文本，再写一个列表”，在 Markdown 里这是两个并列块；原生导入通常会把它们创建为同级 Rem，而不是把列表自动挂到上一行下面。想要“包一层”，可以把标题也写成列表根节点（`- 标题`）或用标题语法（`# 标题`）配合 `parse_mode: ast`（见下）。

## 3) 进阶：AST/Prepared（按标题分段）

`create_tree_with_markdown.parse_mode = "ast" | "prepared"` 时，插件会用 remark 把 Markdown 按标题分段：标题用 `createSingleRemWithMarkdown`，正文用 `createTreeWithMarkdown`，适合“标题层级 = Outline 层级”的文档导入（见 `packages/plugin/src/bridge/remnote/markdown.ts` 的 `parseMarkdownBlocks`）。

## 4) CLI 用法（用于 A/B 对比）

- native（默认）：`agent-remnote import markdown --ref 'page:demo' --file ./b.md`
- indent：`agent-remnote import markdown --ref 'page:demo' --file ./a.md --mode indent`
- staged（可选，减少 UI 抖动）：`agent-remnote import markdown --ref 'page:demo' --file ./b.md --staged`
- 缩进宽度：`--indent-size 2`（会写入 `indent_size`，仅在 indent 模式生效）
  - 便利规则：如果**未显式指定** `--mode`，但传了 `--indent-size`，CLI 会自动切到 `indent` 模式
- 行内传入：用 `--markdown` 直接传字符串（适合快速 A/B 与脚本化）
- 标准输入：`--stdin` 或 `--file -`（可配合 HereDoc / pipe）
  - HereDoc 示例：`agent-remnote import markdown --ref 'page:demo' --file - <<'MD'\n- root\n  - child\nMD`

### 例：一次导入 3 级 Rem（含 link + 双链）

```bash
agent-remnote import markdown --parent "<parent_id>" --staged --markdown $'- L1 [OpenAI](https://openai.com)\n  - L2 ((<remId>))\n    - L3 plain text'
```

## 5) position / 原地替换（并发与稳定性）

- `create_tree_with_markdown.position` 会触发“先导入，再 moveRems 到指定位置”的流程；实现上只移动**根节点**（`parent==parentId`），避免把子节点抬平导致标题/正文顺序错乱。
- `position` 是 0-based 的 sibling index，执行时页面内容若被用户编辑/移动，插入点可能漂移；需要“位置稳定/不被并发编辑影响”时，优先用 `replace_selection_with_markdown(target.mode='expected')` 做原地替换（执行时会校验 selection 未变化）。
