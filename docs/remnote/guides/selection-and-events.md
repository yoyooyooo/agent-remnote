# 选区（Selection）与事件（Events）用法食谱

## TL;DR

- “能用响应式就别手写订阅”：UI 内优先 `useTracker`；必要时再用事件监听。
- 选区读取核心 API：`plugin.editor.getSelection()`，返回值包含 `SelectionType`（如 Text/Rem）。
- 本仓库执行器插件会在“控制通道已连接”时，把选区变更推送给后端（用于交互式写入/替换）。

## 1) 选区类型（SelectionType）

常见的两类：

- `SelectionType.Text`：文本选区（通常携带 `remId` 与 `richText`）。
- `SelectionType.Rem`：Rem 选区（通常携带 `remIds` 数组）。

实践建议：

- 在写入/替换类操作前，先判断选区类型，再决定“目标 Rem”与“插入位置/替换范围”。

## 2) 响应式读取（推荐）

典型模式是让组件跟随选区变化自动重渲染（避免自己维护缓存/订阅）：

- 使用 `useTracker` 包裹 `plugin.editor.getSelection()`（细节以官方示例为准）。

## 3) 事件监听（必要时）

当你需要在插件层做“全局副作用”（例如把选区同步到 WS），可以监听事件：

- `AppEvents.EditorSelectionChanged`
- `AppEvents.FocusedRemChange`
- `AppEvents.FocusedPortalChange`

建议：

- listener key 要稳定且具备命名空间；
- Native 模式下务必在 `onDeactivate` 清理（避免泄漏与重复触发）。

## 4) 本仓库：选区同步到 WS（SelectionChanged）

执行器插件在控制通道连接后，会发送：

- `type: "SelectionChanged"`
- `kind`：`none | rem | text`（本仓库对“Selection”的归一化结果）
- `selectionType`：字符串（来自 `SelectionType`，用于诊断）
- `remIds`：当 `kind=rem` 时存在；最多 200 个（过多会截断并置 `truncated=true`）
- `totalCount`：当 `kind=rem` 时表示选中的 Rem 块数量（即便截断也保留）
- `truncated`：当 `kind=rem` 时可能为 true
- `remId/range/isReverse`：当 `kind=text` 时存在；表示单个 Rem 内的文本高亮选区（`range.start !== range.end`）
- `ts`：时间戳

注意：本仓库把“Selection”定义为“用户可见的高亮”。单纯移动光标（caret）属于 Focus（见 `UiContextChanged.focusedRemId`），不会作为 selection 上报（`SelectionType.Text` 且 `range.start === range.end` 会被归一化为 `kind=none`）。

后端（WS bridge）会回 `SelectionAck` 并把选区写入 bridge state。

代码锚点：

- 插件侧：`packages/plugin/src/widgets/index.tsx`（`registerSelectionForwarder` / `forwardSelectionSnapshot` / `getSelectedRemIds`）
- 服务端：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts`（`case "SelectionChanged"`）

## 5) 本机参考（若存在）

- 事件与监听：`guides/events-and-listeners.md`（位于你的本机提炼版目录中，例如 `~/llms.txt/docs/remnote`）
