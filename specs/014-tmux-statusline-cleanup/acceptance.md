# Acceptance (014): tmux statusline cleanup

## Scope

- Stop/restart/status 触发的展示工件清理与 tmux 刷新
- tmux helper 的 pid gate（避免 stale snapshot 短时间误显示）

## Done

- US1: `agent-remnote daemon stop` 幂等清理展示工件并触发刷新
- US2: `agent-remnote daemon restart` stop 阶段复用清理，避免旧状态残留
- US3: `agent-remnote daemon status` stale 自愈清理；daemon 优雅退出（SIGTERM/SIGINT）清理；tmux helper pid gate 兜底

## Verification

- Contract tests 覆盖 stop/restart/status 的清理语义（见 `packages/agent-remnote/tests/contract/*statusline*.test.ts`）
- 手动验收步骤见 `specs/014-tmux-statusline-cleanup/quickstart.md`

