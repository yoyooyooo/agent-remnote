# 交接：RemNote 插件迁移到 `packages/plugin/`（Vite）

## 结论
- `packages/plugin/` 为当前唯一插件包（Vite 构建）。
- 旧的 webpack 版插件包已从仓库中移除；如需回溯仅能通过历史记录/归档对照。

## 已落地内容
- 新增 `packages/plugin/`：Vite 构建、产出 `dist/` 并打包为 `PluginZip.zip`。
- 产物对齐 RemNote 约束：zip 根目录包含 `manifest.json`、`index.js`、`index-sandbox.js`、`index.css`、`index-sandbox.css`、`index.html`，其余依赖以 `*-<hash>.js` 形式同包发布。
- dev server：在开发模式下提供 `/index.js`、`/index-sandbox.js` 等“入口垫片”，以兼容 `index.html?widgetName=...` 的动态加载方式。

## 需要人工确认的验证点（在 RemNote 客户端）
1) 安装 `packages/plugin/PluginZip.zip` 并启用
2) 执行插件命令（如“连接控制通道 / 启动同步操作 / 查看剩余同步操作”）确认与服务端 WS 交互正常
3) 若有需要：在 RemNote 的 widget sandbox/预览场景下确认 `index.html` 动态加载 `*-sandbox.js` 正常

## 注意事项
- `packages/plugin/public/manifest.json` 的 `id` 当前与 webpack 版一致；如需**并行安装**两份插件，请先改 `id`。
- Vite 版会产生多个 `*-<hash>.js` chunk；虽然 webpack 版也存在拆分文件，但仍建议在 RemNote 内做一次真实安装验证。

## Next Action（迁移推进建议）
- 无需再处理 `packages/remnote-plugin/`：当前以 `packages/plugin/` 为唯一真相源；如要避免误用，只需在文档/脚本中避免残留锚点。
