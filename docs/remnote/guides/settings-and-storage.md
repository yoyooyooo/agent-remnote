# 设置（Settings）与存储（Storage）用法食谱

## TL;DR

- Settings：出现在 RemNote 的插件设置 UI，适合“用户可配置项”（并可同步）。
- Storage：KV 存储（Session/Synced/Local），适合“内部状态/缓存/偏好”。
- 本仓库执行器插件用 Settings 承载 WS 端口、自动连接/自动同步、并发度等开关；用 Local Storage 持久化 `clientInstanceId`（用于诊断归因；无需用户配置）。

## 1) Settings（推荐用在“需要用户理解/确认”的配置）

常用流程：

- `plugin.settings.registerStringSetting/registerBooleanSetting/...`
- `plugin.settings.getSetting(id)`

本仓库代码锚点：`packages/plugin/src/bridge/settings.ts`（`ws-port` / `auto-connect-control` / `auto-sync-on-connect` / `sync-concurrency` 等；`clientInstanceId` 存入 Local Storage 自动生成；插件入口为 `packages/plugin/src/widgets/index.tsx`）

## 2) Storage（三种 KV 的选择）

（具体语义以官方为准，这里只给选型建议）

- Session：临时状态（会话级）。
- Synced：跨设备同步的用户级状态（适合轻量偏好/开关）。
- Local：本机持久但不云同步（适合设备相关偏好/调试缓存）。

## 3) 实战建议

- 只要用户需要“看见/修改/背书”的，就用 Settings；
- 只要是内部运行状态，就用 Storage（并限制 key 的生命周期与迁移策略）；
- 批量写入/危险操作的开关不要藏在 Storage 里，必须可见可控。

## 4) 本机参考（若存在）

- 设置与存储：`guides/settings-and-storage.md`（位于你的本机提炼版目录中，例如 `~/llms.txt/docs/remnote`）
