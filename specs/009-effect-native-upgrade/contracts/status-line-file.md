# Contract: StatusLine File Mode（tmux 读取缓存文件）

**Date**: 2026-01-25  
**Spec**: `specs/009-effect-native-upgrade/spec.md`

## Goal

tmux 渲染 status-right 时不再启动 node/tsx；只读取缓存文件。缓存文件由 daemon/CLI 在关键事件下更新，并受统一节流约束。

## File Path

- Default: `~/.agent-remnote/status-line.txt`
- Override: `REMNOTE_STATUS_LINE_FILE`
- 写入必须原子（write tmp → rename）

## Output Format (string)

- 单行文本（无换行或以 `\\n` 结尾均可，tmux 侧以 `cat` 结果为准）
- 基础片段（connection base）：
  - `RN`：连接 ok 且无 selection
  - `TXT`：selection 为 text
  - `${N} rems`：selection 为 rem 且可得 count
  - `WSx`：daemon/state 不可用或 stale（避免误导为正常）
  - `OFF`：state file disabled（显式关闭）
- 当 `queueOutstanding>0` 时追加 `↓N`（无论 connection base 是什么）

示例：
- `RN`
- `TXT ↓3`
- `WSx ↓12`
- `OFF`

## tmux Config (example)

```tmux
set -g status-right '#(cat ~/.agent-remnote/status-line.txt 2>/dev/null)'
```

## Refresh Policy

- 更新触发点为事件驱动（enqueue/dispatch/ack/selection/uiContext/active-worker-change 等）
- 刷新需统一节流（默认最小间隔 250ms，可 env 覆盖）
- daemon 不可达时 CLI 必须 fallback 更新文件（至少 `↓N`），并 best-effort 触发 `tmux refresh-client -S`

### Throttle Config

- Default min interval: `250ms`
- Override: `REMNOTE_STATUS_LINE_MIN_INTERVAL_MS`

## Optional: Debug JSON Sidecar

为增强可诊断性，允许在 debug 模式下额外写一个 JSON sidecar：

- Default: `~/.agent-remnote/status-line.json`
- Override: `REMNOTE_STATUS_LINE_JSON_FILE`
- Enable: `REMNOTE_STATUS_LINE_DEBUG=1`

建议字段（可增量扩展，forward-only）：
- `updatedAt`
- `source`: `daemon | cli_fallback`
- `connection`: `ok | down | stale | off | no_client`
- `selected`
- `queueOutstanding`
- `throttle`: `{ minIntervalMs, lastWriteAt }`
