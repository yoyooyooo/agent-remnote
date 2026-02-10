# Research: tmux statusline cleanup (014)

## Current Inventory（现状盘点）

- tmux RN 段（fast path）读取 `ws.bridge.state.json` 并以 `updatedAt` 做 staleness 判定；**不检查 daemon 是否仍存活**，因此 stop/crash 后可能在 stale 窗口内继续显示旧状态。
- CLI/daemon 的路径解析与 tmux 脚本不一致：
  - tmux helper: `REMNOTE_WS_STATE_FILE` / `WS_STATE_FILE` / `$HOME/.agent-remnote/ws.bridge.state.json`
  - CLI config provider: 仅使用 `REMNOTE_WS_STATE_FILE`（不读取 `WS_STATE_FILE`）
  - status-line file 模式也存在类似的“不同来源的路径可能不一致”问题
- `tmux refresh-client -S` 的既有实现是 best-effort 且默认只刷新“当前 client”（在非 tmux 环境运行时可能无效）。

## Key Findings（影响设计的事实）

1. tmux 的 `refresh-client` 命令支持 `-t target-client`，但**没有**“刷新所有 clients”的单开关；需要 `list-clients` 后逐个刷新。  
2. `tmux list-clients -F '#{client_name}'` 可作为 target-client 的来源；`tmux refresh-client -S -t <client_name>` 可用（已本地验证）。  
3. “彻底消除路径不一致”需要一个跨进程、由 daemon 实例写入且可被 stop/restart/status 读取的单一事实源：pidfile 是天然承载体。

## Decisions（裁决）

- **Pidfile 作为 source of truth**：在 `ws.pid` 中记录本实例实际使用的展示工件路径（bridge snapshot / status-line file 等），stop/restart/status 以其为准执行清理。
- **统一清理策略**：
  - 删除 bridge snapshot（避免 stale 窗口内继续显示）
  - 将 status-line file 写为空（或删除）以确保 file mode 不残留
  - 清理 best-effort：失败不影响 stop/restart 主语义，但必须可诊断
- **tmux 刷新策略**：`list-clients` → 对每个 client 执行 `refresh-client -S -t`；失败时退化为尝试刷新当前 client。
- **非正常停止兜底**：优雅退出时清理 + tmux helper 增加 pid gate（pid 不存活则隐藏 RN 段）。

## Risks / Notes

- 若在 daemon 仍运行时误清理 snapshot，可能造成短暂 flicker；因此清理仅在 stop/restart 或 status 判定 stale 时触发。
- 强制终止无法捕获；pid gate 作为最后兜底，确保下一次刷新不误显示“connected/selection”。
- tmux 不可用时，刷新会退化；但只要展示工件被清理，RN 段不会在后续刷新中继续出现。
