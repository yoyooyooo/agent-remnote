# UI 上下文与持久化规范（SSoT）

## 目标与边界

- 目标：让 Agent 在本地环境中**实时感知**用户在 RemNote 客户端里的“当前所处状态”，并能据此进行只读查询与安全写入（写入仍必须走队列 + 插件执行链路）。
- 红线：禁止直接修改 RemNote 官方数据库 `remnote.db`；只读访问允许。
- 约束：UI 状态属于 RemNote 客户端运行态信息，**只能由插件侧感知**；SQLite 只能提供知识库内容/结构等“数据态”信息。

## 三种模式（明确取舍）

### 模式一：UI Push（事件驱动）

- 插件监听 RemNote UI 事件（`AppEvents.*`）并在事件触发时把“UI 快照”推送给后端。
- 优点：最接近“真实用户交互”；无需轮询。
- 缺点：仅能拿到 SDK 提供的可观测信号；不能覆盖所有 UI 细节。

### 模式二：DB Pull（SQLite 只读查询）

- 后端/Agent 通过本地只读 SQLite 查询 RemNote 的数据态（Rem 内容、父子结构、引用关系、索引等）。
- 优点：内容丰富、可复现、适合重计算与语义分析。
- 缺点：无法直接得知“用户当前看的是哪一页/光标在哪/选择了什么”这类运行态；且 DB 写盘有延迟。

### 模式三：混合（默认）

> **默认采用此模式。**

- 用 UI Push 解决“用户当前在哪里”（IDs / 少量上下文）。
- 用 DB Pull 在需要时按 ID 补全“用户正在看的内容/结构/引用”等大信息。
- 用轻量 JSON state 解决“跨进程可读的最后快照”（可被 CLI/脚本/Agent 读取），避免强依赖长连接。

## 状态分层：哪些存哪里

### 1) WS Bridge 内存态（实时）

- 位置：`packages/agent-remnote/src/runtime/ws-bridge/runWsBridgeRuntime.ts` 的 `state.clients`（按 WebSocket 客户端隔离）。
- 内容：每个 client 的最新 `selection`、`uiContext` 等快照 + 心跳时间。
- 用途：实时对外查询（`agent-remnote daemon status` / `QueryClients`），以及写入 state file 的数据源。

### 2) JSON state file（跨进程快照，非历史）

- 默认路径：`~/.agent-remnote/ws.bridge.state.json`（可用 `REMNOTE_WS_STATE_FILE`/`WS_STATE_FILE` 覆盖；设为 `0` 可禁用）。
- 语义：**只保存“每个 client 的最后一次快照”**，不保存事件历史。
- 生命周期：该文件是 best-effort 的“最后快照”。当 daemon 停止/自愈清理时，文件可能被删除；读取方必须把“文件不存在”视为 `down` 并降级处理。
- 必备字段：
  - `clients[].selection`：用户选择快照（本仓库归一化为 `kind=none|rem|text`；用于 agent 感知“当前有哪些高亮选区”）。
  - `clients[].uiContext`：用户 UI 上下文（用于 agent 感知“当前页面/焦点 Rem”等）。
  - `updatedAt`：写入该快照的时间戳。
- 过期策略：读取方必须做 staleness 判定（例如默认 `60s`）；过期视为“不可信实时 UI”，但仍可用于提示/回退策略。

### 3) SQLite（持久态）

- `~/.agent-remnote/store.sqlite`：我们的 Store DB（写入队列 + 回执/映射 + 未来自动化数据基座；持久化、可追溯）。
- `remnote.db`：RemNote 官方库（只读），作为“知识库数据态”事实来源。
- 原则：SQLite 只用于**内容/结构/引用**等重数据；不尝试用它模拟 UI 运行态。

补充：

- `store.sqlite` 现在还持久化 `workspace_bindings`，用于维护 `workspaceId -> dbPath` 的长期绑定关系。
- 当前默认 workspace 指针也存于 `workspace_bindings.is_current`，供零配置 DB read 与 Host API status 复用。
- `api.state.json` 继续只是运行时快照，不承载长期 binding。

## UI 快照协议（WS 消息）

### `SelectionChanged`（已存在）

- 目的：让后端/Agent 知道“用户当前高亮了什么”。
- 本仓库归一化（agent 语义）：
  - `kind=rem`：框选/高亮了一个或多个 Rem 块（携带 `remIds/totalCount/truncated`）。
  - `kind=text`：在某个 Rem 内高亮了部分文本（携带 `remId/range/isReverse`）。
  - `kind=none`：无高亮选区（特别地，caret/光标移动不会算 selection）。

### `UiContextChanged`（已实现）

- 目的：让后端/Agent 知道“用户当前在哪个页面、光标在哪个 Rem、在哪个视图容器里”。
- 字段（最小集合）：
  - `kbId`：当前 Knowledge Base / workspaceId（用于选择对应 `~/remnote/remnote-<kbId>/remnote.db`）
  - `kbName`：当前 Knowledge Base 名称（用于日志/诊断）
  - `url`：当前地址栏 URL（可用于判定是否在队列/搜索等页面）
  - `paneId`：当前 focused pane
  - `pageRemId`：`paneId` 当前打开页面 RemId
  - `focusedRemId`：当前焦点 RemId（光标所在 Rem）
  - `focusedPortalId`：承载该焦点的 portal RemId（区分不同视图实例）
  - `source`：触发源（`connect` / `event:*`）
  - `ts`：发送时间戳

说明：获取 `kbId/kbName` 需要插件在 manifest 中声明 `requiredScopes` 包含 `{ "type": "KnowledgeBaseInfo", "level": "Read" }`。

## 字段与 RemNote 界面的对应关系（面向 Agent 的最小语义）

> 目标：让 Agent 能把用户基于可视化界面的指代（这页/这行/选中的/这个嵌入）落到稳定 ID，然后再用 DB Pull 补全内容与结构。

- `pageRemId`：用户语义里的“当前页面/这页/这个文档”（focused pane 顶部标题对应的页面）。常用于“往当前页面写入/追加内容”的 `parentId`。
- `focusedRemId`：用户语义里的“光标所在块/当前行/这一条”。常用于“替换当前块/围绕当前行插入”的目标或锚点。
- `selection`：用户语义里的“我高亮的选区”。当用户明确提到“选中/高亮/选区”，应优先用 selection 而不是 focus：
  - `kind=rem`：我框选的这些 Rem（可多选）。
  - `kind=text`：我在某个 Rem 内高亮的那段文本（单段）。
- `paneId`：用户当前键盘输入所在窗格（RemNote 支持多窗格）。当前系统只保证提供 focused pane 的上下文；若用户提到“另一个窗格”，应引导其先聚焦到对应窗格再继续。
- `focusedPortalId`：焦点所在的 Portal 容器（例如嵌入/投影视图）。用于区分“用户在可视化上正在操作哪个容器”；当用户说“在这个嵌入里…”，应优先参考该字段并在不确定实际落库位置时追问澄清。
- `kbId`：当前 Knowledge Base（workspace）标识。Agent 做 DB Pull 前应优先确保 kbId 正确，以免读取到另一个知识库的 `remnote.db`。
- `url`：用于粗判界面是否处在“普通页面编辑”之外（例如 Search/Queue）。在这类界面里 `pageRemId`/focus 可能为空或不稳定，应更保守地询问目标页面/父级 ID。

当前定型行为：

- live `uiContext.kbId` 是建立或刷新 workspace binding 的最强信号。
- 一旦 `kbId` 能解析到 `~/remnote/remnote-<kbId>/remnote.db`，宿主机应立即把该 binding 写入 Store DB，并更新 current workspace。
- 后续即使插件短暂离线，只要 binding 仍可验证，DB read 也应继续命中同一 workspace。

## 快照归一化（Normalization）

UI Push 的事件是“增量信号”，而 state file 保存的是“最后快照”；为了贴近用户直觉并避免脚本误判，本仓库允许对快照做少量归一化：

- **避免 selection 残留（块级）**：当 `selection.kind=rem` **非截断**且 `uiContext.focusedRemId` 存在，但 `focusedRemId` 不在 `selection.remIds` 内时，认为用户已离开选区，selection 视为已清空（写回 state）。
- **避免 selection 残留（文本）**：当 `selection.kind=text` 且 `range.start===range.end`（caret）或 `selection.remId !== uiContext.focusedRemId` 时，selection 视为已清空（写回 state）。

同时要接受一个现实：`focusedRemId` 并不总是存在，例如：

- 多 Rem 选区时（可能没有单一光标锚点）
- 非编辑界面/没有光标时（例如 Search/Queue 等页面）

并且需要接受一个事实：`focusedRemId` 与 `selection` 是两个概念：

- `focusedRemId`：光标所在 Rem（Focus）。
- `selection`：用户可见高亮（Selection）；caret（折叠文本选区）不算 selection。

脚本侧如需推断“当前目标”，推荐优先级：

1. `selection.kind=rem`（用户框选了 Rem 块）
2. `selection.kind=text`（用户高亮了文本）
3. `uiContext.focusedRemId`（光标所在 Rem）
4. `uiContext.pageRemId`（当前页面 Rem）

## 事件监听规范（关键坑位）

- `plugin.event.addListener(eventId, key, cb)` 的第二个参数是 **event key**：
  - **全局事件必须传 `undefined`**（例如 `AppEvents.URLChange`、`AppEvents.EditorSelectionChanged`）。
  - keyed 事件才传 key（例如 `AppEvents.RemChanged` 的 key=RemId）。
- 不要把第二个参数当作“listener id”。移除 listener 时如需精确移除，应传入同一个 `key`（以及必要时传同一个 `cb`）。

## 仍缺的“现状”建议（按优先级）

> 这些不一定都要 Push；优先遵循“IDs-first + DB 补全”。

1. **Queue 上下文**：是否在队列、当前 card/rem、剩余数量、是否 reveal（`plugin.queue.*` + `AppEvents.QueueEnter/QueueExit/...`）。
2. **选择细节**：TextSelection 的 `range/isReverse` 与选中文本（可截断），PDF/WebReader 的 `text`（同样截断）。
3. **多 pane 全景**：`openPaneIds/openPaneRemIds` 与 window tree（用于“用户同时打开了哪些页面”）。

## 结论（定型）

- 默认采用**模式三（混合）**：UI Push 负责“实时位置/焦点/选择”，DB Pull 负责“内容与结构”，JSON state file 负责“跨进程最后快照”。
- state file 只存**快照**不存历史；需要事件历史时另做可选的 debug ring buffer（默认关闭）。
