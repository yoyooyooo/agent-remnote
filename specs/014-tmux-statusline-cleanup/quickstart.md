# Quickstart (014): How to validate tmux statusline cleanup

> 用于实现完成后的本地验收：验证 stop/restart/status 会清理展示工件并触发 tmux 刷新，RN 段不会残留显示。

## 1) tmux RN 段配置

按 `docs/guides/tmux-statusline.md` 配置 RN 段（推荐 `scripts/tmux/remnote-right-segment.tmux.sh`）。

## 2) 验证 `daemon stop` 清理展示工件（不依赖真实 daemon）

1. 准备一个临时 HOME，并写入“新鲜的 snapshot”与“非空 status-line file”：
   - `~/.agent-remnote/ws.bridge.state.json`（updatedAt=now，clients 非空）
   - `~/.agent-remnote/status-line.txt`（写任意非空字符串）
2. 执行 `agent-remnote daemon stop`（指向该 HOME）。
3. 预期：
   - `ws.bridge.state.json` 被删除
   - `status-line.txt` 变为空（或被删除）
   - tmux RN 段在 1 秒内消失（或在下一个刷新周期内消失）

## 3) 验证 `daemon restart` 失败路径不残留

1. 在 RN 段可见时执行 `agent-remnote daemon restart`，并让 start 阶段失败（例如通过错误配置/端口冲突模拟）。
2. 预期：命令退出后 RN 段保持隐藏/down，不会继续显示 restart 前的旧状态。

## 4) 验证 `daemon status` stale 自愈

1. 写入一个 pidfile 指向不存在的 pid（stale），并遗留展示工件（snapshot/status-line）。
2. 执行 `agent-remnote daemon status`。
3. 预期：status 会自愈清理 stale pidfile/state，并清理展示工件，使 RN 段不再残留。

## 5) 验证 tmux helper 的 pid gate（推荐）

1. 写入一个 pidfile 指向不存在的 pid（stale），同时写入一个“看起来新鲜”的 `ws.bridge.state.json`（`updatedAt=now`）。
2. tmux 下一次刷新时，RN 段应保持隐藏（不因 snapshot 新鲜而误显示）。
3. 若你使用了自定义 pidfile 路径，确保 tmux 脚本侧设置 `REMNOTE_DAEMON_PID_FILE/DAEMON_PID_FILE` 与 CLI 的 `--pid-file` 对齐。
