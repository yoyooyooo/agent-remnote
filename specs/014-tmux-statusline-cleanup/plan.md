# Implementation Plan: tmux statusline cleanup (014)

**Branch**: `014-tmux-statusline-cleanup` | **Date**: 2026-01-26 | **Spec**: `specs/014-tmux-statusline-cleanup/spec.md`  
**Input**: Feature specification from `specs/014-tmux-statusline-cleanup/spec.md`

## Summary

把“tmux RN 段是否显示”从“最多等 stale 窗口”升级为“stop/restart/status 立即对齐到真实状态”，并消除导致残留的两类根因：

1. **展示缓存未清理**：bridge snapshot / status-line file 仍存在且仍被 tmux 脚本读取。  
2. **路径不一致**：tmux 脚本与 CLI/daemon 解析的文件路径不一致，导致清理落空。

核心策略：把“实际使用的展示工件路径”写入 pidfile 作为单一事实源（source of truth），并由 stop/restart/status 统一执行 best-effort 清理 + tmux 全 client 刷新；同时为非正常退出提供最小兜底（优雅退出清理 + tmux helper pid gate）。

## Technical Context

**Language/Version**: TypeScript (ESM) + Node.js 20+  
**Primary Dependencies**: `effect` / `@effect/cli` / `ws` / `better-sqlite3`  
**Storage**: local state files under `~/.agent-remnote/*` + queue sqlite `~/.agent-remnote/queue.sqlite`  
**Testing**: Vitest  
**Target Platform**: Node.js 20+ + tmux (local machine)  
**Project Type**: bun workspaces (npm scripts + turbo)  
**Performance Goals**: stop/restart/status should converge RN segment visibility within 1s (or the next tmux refresh tick)  
**Constraints**:
- CLI 输出/错误信息必须英文（本 feature 只调整行为与内部工件，不新增中文输出）
- 路径必须走 `homedir()+join/normalize`；支持 `~` 展开
- stop/restart/status 必须非破坏性：只清理“展示缓存/快照”，不得删除队列 DB、日志等持久/排障证据
**Scale/Scope**: single user; potentially multiple tmux clients/panes; env overrides; crash/force-terminate edge cases

## Constitution Check（逐条映射）

> 依据 `.specify/memory/constitution.md`，此处为“收口门禁”；若必须违反，需写入 Complexity Tracking。

1. 禁止直接修改 `remnote.db`：**PASS**（仅处理 statusline/bridge snapshot/daemon 工件）。  
2. Forward-only evolution：**PASS**（允许对 pidfile 扩字段；如涉及行为变更，同步文档与 tests）。  
3. SSoT 优先：**PASS**（实现与 `docs/ssot/agent-remnote/**` 如有差异，在收尾同步；本 feature 不引入长期兼容层）。  
4. 预算与超时兜底：**PASS**（清理仅文件 IO + best-effort tmux 命令；不得引入无界阻塞）。  
5. 唯一消费与身份：**N/A**（不改队列消费/WS identity）。  
6. 跨平台路径规范：**PASS**（所有新增路径字段与清理逻辑必须用现有 `resolveUserFilePath`）。  
7. 语言：**PASS**（不新增中文 CLI 输出；代码注释如需新增，用英文）。  
8. 可验证性：**PASS**（新增/扩展 contract tests 覆盖 stop/restart/status 的清理与路径一致性）。  
9. 非破坏性默认：**PASS**（仅清理展示缓存；保留 queue/db/log）。  
10. 跨进程 state 语义单一：**PASS**（bridge snapshot 与 supervisor state 分文件；pidfile 仅记录路径元信息）。  
11. 架构边界门禁：**PASS**（变更集中在 daemon 命令/服务/脚本；必要时补 contract test）。  
12. Write-first：**N/A**（不改写入链路）。  
13. Agent Skill 同步：**PASS**（不改命令面；若新增 env/字段需在 docs/skills 中补齐）。

## Phase Plan（落地顺序）

### Phase 0：Artifacts 作为实现基线

- 生成并固化本 feature 的：
  - `research.md`：确认 tmux refresh 的可行命令与 target-client 选择
  - `data-model.md`：定义“展示工件”与 pidfile 扩字段语义
  - `contracts/*`：固化 stop/restart/status 的行为契约（不涉及网络 API）
  - `quickstart.md`：提供复现与验收步骤

### Phase 1：路径单一事实源（Pidfile 扩展）

- pidfile 增加字段（forward-only）：
  - `ws_bridge_state_file`: 实际使用的 bridge snapshot 路径
  - `status_line_file`: 实际使用的 status-line file 路径
  - `status_line_json_file`: 实际使用的 debug json 路径（可选；若未启用也可记录）
- 写入点：
  - daemon start/supervisor start 写 pidfile 时填充上述字段
  - supervisor runtime 周期性更新 pidfile 时保持这些字段不丢失（或每次都写回）

### Phase 2：统一清理入口（stop/restart/status）

- 抽出统一的 best-effort 清理函数（概念上“StatuslineArtifactsCleanup”）：
  - 优先读取 pidfile 中记录的路径进行清理；pidfile 缺失则回退到当前解析出的 config 路径
  - 删除/置空：`ws_bridge_state_file`；将 `status_line_file` 写为空（或删除）以确保 file mode 不残留
  - 清理失败不应改变 stop/restart 的主流程结果，但必须提供可诊断信息（在 debug/contract 输出中可见）
- 接线：
  - `daemon stop`：所有成功分支都执行清理 + tmux 刷新
  - `daemon restart`：stop 阶段复用相同清理；start 失败时也必须保持“已清理”
  - `daemon status`：当检测到 pidfile stale 并自愈删除 pidfile/state 时，顺带清理展示工件，避免 tmux 误显示

### Phase 3：tmux 全 client 刷新（不依赖当前 TMUX 环境）

- 刷新策略：
  - `tmux list-clients -F '#{client_name}'` → 逐个执行 `tmux refresh-client -S -t <client_name>`
  - list 失败时退化为当前实现（尝试 `refresh-client -S`）
- 保留现有的开关与节流（`REMNOTE_TMUX_REFRESH*` / config），避免高频刷新抖动。

### Phase 4：非 stop 退出兜底（优雅退出 + 脚本 gate）

- 运行时优雅退出（SIGTERM/SIGINT）时 best-effort 清理展示工件并触发 tmux 刷新，覆盖常见终止场景。  
- tmux helper 脚本增加 pid gate：当 pidfile 存在且 pid 不存活时，无论 snapshot 是否“新鲜”，RN 段都应隐藏（避免 crash/强杀留下短期误显示）。

### Phase 5：Tests & Docs

- Tests（Vitest）：
  - contract：stop/restart/status 在“路径一致/路径不一致/残留缓存存在”的条件下，展示工件最终一致被清理
  - unit：tmux refresh “全 client”逻辑（mock child_process）
  - regression：确保不影响现有 daemon/supervisor tests
- Docs：
  - 更新 `docs/guides/tmux-statusline.md`（增加 pid gate 与路径来源说明）
  - 如 pidfile schema 公开/诊断字段对外可见，同步 `docs/ssot/agent-remnote/ui-context-and-persistence.md` 或相关 SSoT

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| - | - | - |
