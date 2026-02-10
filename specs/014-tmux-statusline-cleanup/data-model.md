# 数据模型：tmux statusline cleanup（014）

> 本特性不引入新的业务数据结构；核心是定义“展示工件（display artifacts）”与“运行态工件（runtime artifacts）”的语义与清理策略，并用 pidfile 承载“实际路径”作为单一事实源。

## 工件与语义

### 1) `ws.pid`（daemon pidfile；运行态工件）

默认位置：`~/.agent-remnote/ws.pid`（CLI 可用 `--pid-file` 覆盖）。

用途：

- 让 stop/status/restart 能定位 daemon/supervisor 进程并做自愈清理
- 作为跨进程“本实例实际配置”的事实源（本 feature 扩展）

建议字段（新增为 forward-only）：

- `ws_bridge_state_file: string`：本实例写入/使用的 bridge snapshot 路径（见下）。
- `status_line_file: string`：本实例写入/使用的 status-line file 路径（file mode）。
- `status_line_json_file: string`：debug json 路径（仅当 debug 模式启用时真正写入，但路径可记录）。

约束：

- 所有路径必须是 `resolveUserFilePath()` 规范化后的绝对/归一化路径（允许用户输入 `~`）。
- supervisor runtime 更新 pidfile 时不得丢失上述字段（保持一致性）。

### 2) `ws.state.json`（supervisor state；运行态工件）

默认位置：`~/.agent-remnote/ws.state.json`（通常与 pidfile 同目录；可由 supervisor 参数覆盖）。

用途：记录 supervisor 的运行状态（running/stopping/failed 等），用于诊断与自愈。

清理：stop/restart/status 在判定 daemon 不存活或显式 stop 后应删除。

### 3) `ws.bridge.state.json`（bridge snapshot；展示工件）

默认位置：`~/.agent-remnote/ws.bridge.state.json`（可 env 覆盖；可禁用）。

用途：

- tmux helper 与 CLI 在无连接/无 daemon 情况下读取“最后快照”
- 读取方必须做 staleness 判定（默认 60s）

清理策略（本 feature 强化）：

- stop/restart/status 在确认 daemon 停止或 stale 自愈时，必须删除该文件，避免 stale 窗口内继续显示“connected/selection”。

### 4) `status-line.txt` / `status-line.json`（statusline file mode；展示工件）

默认位置：

- `~/.agent-remnote/status-line.txt`
- `~/.agent-remnote/status-line.json`（debug）

用途：部分 tmux 配置会读取该文件直接渲染 statusline（不依赖 jq/state file）。

清理策略：

- stop/restart/status 在 stop/stale 自愈时，应将 `status-line.txt` 置空（或删除）并触发 tmux 刷新，避免残留显示。

## 路径来源优先级（清理时）

1. pidfile 中记录的实际路径（source of truth）  
2. 当前 CLI 解析出的 config 路径（env/默认）  
3. 默认路径（`~/.agent-remnote/*`）

## Invariants（必须满足）

1. stop/restart/status 的清理只能作用于“展示工件”，不得删除队列 DB 与日志等持久/排障证据。  
2. 当 pidfile 存在且 pid 不存活时，tmux RN 段不得因为“snapshot 仍新鲜”而继续显示在线/连接状态。  
3. 清理与刷新必须幂等：重复执行不会导致错误或引入新的残留状态。  
