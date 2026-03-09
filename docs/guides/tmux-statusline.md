# tmux statusline：RemNote 右下角 RN 段

本仓库提供一个轻量 helper 脚本，用于在 tmux statusline 中展示 RemNote daemon 的三态状态（隐藏 / 灰底 / 暖底），并在 daemon 有连接时展示 selection 概览。

## Helper 脚本（两层）

- 推荐直接用 tmux 友好版本（不需要自己解析 `\t`）：
  - `scripts/tmux/remnote-right-segment.tmux.sh`
  - 输出：tmux style string，或空输出（表示不显示）
- 底层 value 版本（适合你已有复杂分段/分隔符逻辑）：
  - `scripts/tmux/remnote-right-value.sh`
  - 输出：单行 `"<bg>\t<value>"`，或空输出（表示不显示）
    - `bg`：hex 颜色（例如 `#4c566a`）
    - `value`：例如 `RN` / `TXT` / `3 rems`，可带队列指示 `↓N`

## tmux 配置示例（最小）

```tmux
# 将 RemNote 的 RN 段追加到 status-right（无分隔符版本）
set -g status-right '#(bash /path/to/agent-remnote/scripts/tmux/remnote-right-segment.tmux.sh 2>/dev/null) #{status-right}'
```

## 状态判定

- daemon 未运行 / state file stale：不输出（tmux 不显示 RN 段）
- daemon 运行但无客户端：灰底（默认 `#4c566a`）
- daemon 运行且有客户端：暖底（默认 `#d08770`）

## Pid gate（避免残留显示）

为避免 daemon 已退出但 state file 仍“新鲜”导致 RN 段短时间残留，helper 脚本会尝试读取 pidfile 并做 **pid 存活门禁**：

- pidfile 存在且 pid 不存活：直接不输出（强制隐藏 RN 段）
- pidfile 不存在：回退到 state file 的 `updatedAt` + stale window 判定

同时：当未设置 `REMNOTE_WS_STATE_FILE/WS_STATE_FILE` 时，脚本会优先使用 pidfile 中记录的 `ws_bridge_state_file` 路径（如果存在），用于避免“daemon 写入路径”与“tmux 读取路径”不一致造成的误显示。

说明：CLI 侧（`agent-remnote daemon *`）也会把 `REMNOTE_DAEMON_PID_FILE/DAEMON_PID_FILE` 作为默认 pidfile（当未传 `--pid-file` 时），建议 tmux 与 CLI 使用同一套环境变量以保持一致性。

## 依赖与回退

- 推荐安装 `jq`：用于解析 state file；没有 `jq` 时无法可靠区分“无连接（灰底）”与“有连接（暖底）”。
- 可选安装 `sqlite3`：用于计算 `↓N`（队列 `pending` + `in_flight`）；没有 `sqlite3` 时只显示 base（`RN/TXT/N rems`）。
- 当 fast path 不可用时，脚本会 best-effort 走 `REMNOTE_CLI`（默认 `~/.local/bin/agent-remnote`）的 `daemon status-line` 作为 fallback（注意：该命令在 `no_client` 时会输出空）。

## 常用环境变量

- `REMNOTE_WS_STATE_FILE` / `WS_STATE_FILE`：bridge state file 路径（默认 `~/.agent-remnote/ws.bridge.state.json`）
- `REMNOTE_WS_STATE_STALE_MS` / `WS_STATE_STALE_MS`：stale 阈值（默认 `60000`）
- `REMNOTE_DAEMON_PID_FILE` / `DAEMON_PID_FILE`：daemon pidfile 路径（默认 `~/.agent-remnote/ws.pid`）
- `REMNOTE_STORE_DB` / `STORE_DB`：store sqlite 路径（默认 `~/.agent-remnote/store.sqlite`；legacy：`REMNOTE_QUEUE_DB` / `QUEUE_DB`）
- `TMUX_REMNOTE_BG_NO_CLIENT`：无客户端时背景色（默认 `#4c566a`）
- `TMUX_REMNOTE_BG_CONNECTED`：有客户端时背景色（默认 `#d08770`）
- `TMUX_REMNOTE_FG`：前景色（默认 `#eceff4`）
- `REMNOTE_CLI`：helper 的 fallback CLI（默认 `~/.local/bin/agent-remnote`）
