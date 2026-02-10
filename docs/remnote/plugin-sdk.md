# RemNote 插件 SDK 要点（本仓库落地版）

目标：让你（和自动化代理）能在不翻全站文档的前提下，快速定位“该用哪个 API、有哪些坑、在本仓库哪里改”。

## 1) 两个关键设计：沙箱/原生 + 权限模型

- 默认推荐 Sandboxed（iframe）模式；仅在明确需要时用 Native（`manifest.json.requestNative: true`）。
- 权限是 **Scope（范围）+ Level（读写能力）** 的组合；越权访问往往返回 `undefined`（不是异常），代码必须判空并给出提示。
- `createRem` 的创建位置受“当前最大 Scope”影响（All → 顶级；DescendantsOfName/Id → 对应子树；Powerup → Powerup Rem 下）。

本仓库现状：`packages/plugin/public/manifest.json` 目前使用 `requestNative: true` + `All/ReadCreateModifyDelete` 以覆盖执行器能力（不是通用插件的推荐配置）。

进一步阅读：`docs/remnote/guides/permissions.md`

## 2) 生命周期与注册入口

- 入口：`declareIndexPlugin(onActivate, onDeactivate)`
- 在 `onActivate` 注册 widgets / commands / settings / listeners 等“贡献”。
- 如使用事件监听（尤其 Native），在 `onDeactivate` 清理（removeListener / close ws / clear timers）。

代码锚点：`packages/plugin/src/widgets/index.tsx`

进一步阅读：`docs/remnote/guides/selection-and-events.md`

## 3) Widget 规则（最常见坑）

- `registerWidget('<id>', ...)` 的 `<id>` 必须与 `src/widgets/<id>.tsx` 文件名一致（不含扩展名）。
- 推荐用 `useTracker` 做响应式（选区、设置、存储等变化自动刷新），避免手写订阅。

## 4) 常用能力速查

- 设置：`plugin.settings.register*Setting` + `getSetting`（可配合 `useTracker`）
- 命令：`plugin.app.registerCommand`
- 组件通信：`plugin.messaging.broadcast` + `useOnMessageBroadcast`
- 读写 Rem：`plugin.rem.findOne/findMany/findByName/createRem` + `rem.setText/setBackText/addTag/...`
- 富文本：优先用 `plugin.richText` Builder 构造 RichTextInterface；需要展示文本用 `plugin.richText.toString`

进一步阅读：

- `docs/remnote/guides/richtext.md`
- `docs/remnote/guides/settings-and-storage.md`
- `docs/remnote/guides/commands-and-messaging.md`

## 5) 本仓库执行器（plugin）额外约定

插件在 RemNote 内充当“执行端”：

- 通过 WS 与 bridge 通信（控制通道 + 拉取 op + 回执结果）。
- 暴露了一组调试/运维命令（如“启动同步操作 / 连接控制通道 / 查看剩余同步操作 / 调试写入到每日笔记”等）。
- 会把编辑器选择（selection）变化推送到后端（用于更顺滑的交互式写入）。

开发与预览：

- `packages/plugin` 使用 Vite，dev server 固定端口 `8080`（见 `packages/plugin/vite.config.ts`）。
- 浏览器预览入口：`http://localhost:8080/index.html?widgetName=index`

相关协议细节（权威）：`docs/ssot/agent-remnote/ws-bridge-protocol.md`、`docs/guides/ws-debug-and-testing.md`

## 6) 故障排查（最常见）

- Widget 不显示：优先检查 widget id 与文件名是否一致（见“Widget 规则”）；新增文件后必要时重启 dev server。
- 访问 Rem 返回 `undefined`：优先检查权限范围（Scope/Level）；对 `undefined` 路径必须判空。
- 虚拟嵌入组件不显示：多数需要显式传尺寸（width/height/maxWidth/maxHeight）。

逃生口（RemNote Web）：

- 临时禁用插件：`https://www.remnote.com/notes?disablePlugins`
- 临时禁用自定义 CSS：`https://www.remnote.com/notes?disableCustomCSS`

进一步阅读：`docs/remnote/guides/troubleshooting.md`

## 7) 推荐进一步阅读（优先本机提炼版，其次官方）

若你也维护了本机提炼版（例如 `~/llms.txt/docs/remnote`；Windows：`%USERPROFILE%\\llms.txt\\docs\\remnote`），建议优先阅读其中：

- `guides/api-essentials.md`
- `guides/permissions-cookbook.md`
- `guides/settings-and-storage.md`
- `guides/events-and-listeners.md`
- `guides/richtext-advanced.md`
- `guides/search-recipes.md`
- `troubleshooting.md`

官方入口：https://plugins.remnote.com/
