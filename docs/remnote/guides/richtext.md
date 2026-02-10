# 富文本（RichTextInterface）用法食谱

## TL;DR

- RemNote 的文本字段通常是 `RichTextInterface`（数组结构）。
- 插件内：优先用 `plugin.richText` Builder 构造富文本；展示时用 `plugin.richText.toString`。
- 本仓库执行器插件也支持把“字符串”转为简易 RichText（并支持把 `((remId))` 解析为引用 token），但复杂富文本仍应走 SDK Builder。

## 1) 两条路：Builder（推荐） vs 简易转换（执行器兼容）

### Builder（推荐，信息不丢）

- 用 `plugin.richText` 构造（粗体/高亮/图片/视频/换行/引用等）。
- 适合插件内交互式编辑、需要格式控制的写入。

### 简易转换（执行器兼容，信息有限）

执行器插件内有 `toRichText(input)`：

- `string` → `parseStringRichText`（把字符串拆成 token；支持 `((remId))` 引用）
- `array` → 原样返回（假设已经是 RichTextInterface）
- `object` → 包一层数组

代码锚点：`packages/plugin/src/widgets/index.tsx`（`toRichText` / `parseStringRichText`）

## 2) 引用 token 与“文本里嵌引用”的约定

执行器的简易解析支持形如：

- `((<remId>))`
- `((<remId>|<label>))`

解析后会产生 `{ i: 'q', _id: remId }` token（用于表示引用）。

说明：

- 这是一种“工程约定”，用于让队列写入能表达最小引用需求；
- 复杂富文本（样式、卡片、媒体）请优先在插件侧用 Builder/SDK 能力实现。

## 3) Markdown 写入优先用“原生 markdown API”

本仓库写入链路里，遇到大段 Markdown 时，优先用：

- `create_single_rem_with_markdown`
- `create_tree_with_markdown`

它们由 RemNote 宿主负责解析与落库，比在外部自己转 RichText 更稳。

代码锚点：

- 插件执行器：`packages/plugin/src/widgets/index.tsx`（`executeOp` 中的 `create_*_with_markdown`）
- 工具语义：`docs/ssot/agent-remnote/tools-write.md`

## 4) 本机参考（若存在）

- 富文本进阶：`guides/richtext-advanced.md`（位于你的本机提炼版目录中，例如 `~/llms.txt/docs/remnote`）
