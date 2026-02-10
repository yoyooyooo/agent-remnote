# Quickstart: Effect Native Upgrade（验收清单与最短验证路径）

**Date**: 2026-01-25  
**Spec**: `specs/009-effect-native-upgrade/spec.md`

## 验收门禁（实现阶段使用）

1) **Contract tests**（硬门）
- `npm test --workspace agent-remnote`

2) **Dist smoke**（可选但推荐）
- `npm run smoke:dist --workspace agent-remnote`

3) **StatusLine 文件模式 smoke**
- tmux status-right 改为读取缓存文件（示例配置见 `contracts/status-line-file.md`）
- 触发 enqueue/ack/selection 变化后观察状态栏收敛与频率

4) **静态边界门禁**
- 检查禁止 raw timers/Promise/spawn/sync-fs 出现在非收口层（详见 `contracts/effect-io-guidelines.md`）
- 检查禁止 commands/runtime 直接 `fs.*` 与 `process.env = ...` 注入配置（详见 `contracts/layering-and-boundaries.md`）
- 检查 `kernel/**` 可移植性：禁止任何 `node:*`/`effect/*`/平台依赖进入内核（详见 `contracts/portable-kernel-and-actors.md`）

## 环境变量（实现阶段约定）

- `REMNOTE_WS_STATE_FILE` / `WS_STATE_FILE`：WS bridge snapshot state file（默认 `~/.agent-remnote/ws.bridge.state.json`；设为 `0` 可禁用）
- `REMNOTE_TMUX_REFRESH`：是否启用 tmux refresh（默认启用）
- `REMNOTE_TMUX_REFRESH_MIN_INTERVAL_MS`：刷新最小间隔（默认 250ms）
- `REMNOTE_STATUS_LINE_FILE`：statusLine 缓存文件路径（默认 `~/.agent-remnote/status-line.txt`）
- `REMNOTE_STATUS_LINE_MIN_INTERVAL_MS`：statusLine 写文件最小间隔（默认 250ms）
- `REMNOTE_STATUS_LINE_DEBUG`：是否写 statusLine JSON sidecar（默认关闭）
- `REMNOTE_STATUS_LINE_JSON_FILE`：statusLine JSON sidecar 路径（默认 `~/.agent-remnote/status-line.json`）

## 产物定位

见 `specs/009-effect-native-upgrade/tasks.md` 的分阶段任务与对应文件路径。
