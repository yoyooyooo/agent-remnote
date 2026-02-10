# RemNote 插件与写入链路排障食谱（本仓库）

## TL;DR

- 插件“不显示”：先查 widget id/文件名、位置、是否需要重启 dev server。
- “返回 undefined”：优先按权限模型排查（Scope/Level），并确认代码判空路径完整。
- “不同步/不消费队列”：先确认 WS bridge 启动、插件已连接控制通道、队列统计与日志路径。

## 1) 插件不显示/看不到 Widget

- 检查 `registerWidget('<id>', ...)` 的 `<id>` 是否与 `src/widgets/<id>.tsx` 文件名一致：
  - 本仓库入口：`packages/plugin/src/widgets/index.tsx`
  - 示例 widget：`packages/plugin/src/widgets/sample_widget.tsx`
- 新增文件后必要时重启 `npm run dev`（Vite dev server）。

逃生口（RemNote Web）：

- 禁用插件：`https://www.remnote.com/notes?disablePlugins`
- 禁用自定义 CSS：`https://www.remnote.com/notes?disableCustomCSS`

## 2) WS 连接问题（执行器不消费队列）

先确认三件事：

1. WS bridge 是否在跑：`npm run dev:ws`
2. 插件 Settings 的 WS 端口是否正确（默认 `6789`；会生成 `ws://localhost:<port>/ws`）
3. 插件是否已“连接控制通道”（命令或自动连接开关）

常用检查：

- `npm run ws:health`
- `npm run ws:ensure`
- 若你同时在多个 RemNote 窗口/设备启用了执行器：只有 **active worker** 允许拉取队列；其它连接会收到 `NoWork(reason='not_active_worker', activeConnId)`，表现为“看起来不消费/没反应”。切到目标窗口触发 selection/uiContext 更新即可切换 active worker（无需配置任何 id）。

日志与状态文件（默认）：

- WS daemon（supervisor）：`~/.agent-remnote/ws.log`、`~/.agent-remnote/ws.pid`、`~/.agent-remnote/ws.state.json`
- WS bridge 快照（selection/ui-context）：`~/.agent-remnote/ws.bridge.state.json`（可用 `REMNOTE_WS_STATE_FILE`/`WS_STATE_FILE` 覆盖；设为 `0` 可禁用）
- WS debug：`~/.agent-remnote/ws-debug.log`（`npm run dev:ws:debug:file`）

## 3) 队列有任务但执行失败/反复重试

- 先看 op 的 `op_type` 是否被插件执行器实现：
  - `packages/plugin/src/widgets/index.tsx`（`executeOp`）
- 再看 payload 是否符合工具语义：
  - `docs/ssot/agent-remnote/tools-write.md`
- 以及队列 schema/状态语义：
  - `docs/ssot/agent-remnote/queue-schema.md`

## 4) 本地 DB 读取失败（只读）

- DB 被占用/锁：尽量读备份/副本或稍后重试。
- FTS 不可用：回退到 `remsSearchInfos`/`quanta` 的 JSON 匹配。

入口：`docs/remnote/local-db-readonly.md`
