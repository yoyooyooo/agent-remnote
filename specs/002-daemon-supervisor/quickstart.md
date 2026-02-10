# Quickstart: Supervisor 模式

## 启动/状态/停止

- 启动：`agent-remnote daemon start`
- 状态：`agent-remnote daemon status --json`
- 停止：`agent-remnote daemon stop`

## 验证自愈（示例）

1. `agent-remnote daemon status --json` 找到 child PID
2. 杀掉 child（仅用于本地验证）：`kill -9 <childPid>`
3. 再次 `agent-remnote daemon status --json`，确认 child 被重启且 `restart_count` 增加

## 验证日志轮转（示例）

1. 设定较小阈值（flags/env 其一）
2. 制造足够日志（例如开启 debug 并进行若干次 health/status）
3. 观察 `~/.agent-remnote/ws.log.*` 生成且数量受限
