# Local Runtime Notes

本地调试当前建议按“stable 日用 + source worktree 隔离调试”来理解。

## 当前规则

- 发布安装态默认是 canonical `stable` owner
- source worktree 默认进入 isolated `dev` runtime root 和 isolated ports
- `stack ensure/status/stop` 现在都收口 `daemon + api + plugin`
- `stack takeover --channel dev`：把 canonical claim 切到 `dev`
- `stack takeover --channel stable`：把 canonical claim 切回 `stable`

## 先看什么

```bash
agent-remnote --json config print
agent-remnote --json stack status
agent-remnote --json doctor
```

重点字段：

- `runtime_profile`
- `runtime_port_class`
- `control_plane_root`
- `runtime_root`
- `fixed_owner_claim`
- `services.*`
- `ownership_conflicts`

## 本地 source 调试

在仓库里跑：

```bash
npm run dev -- --json config print
npm run dev -- --json stack status
```

预期：

- `runtime_profile=dev`
- `runtime_port_class=isolated`
- `runtime_root` 落到 `~/.agent-remnote/dev/<worktree-key>`
- isolated 默认端口按解析后的 `runtime_root` 派生

## 切到 canonical dev

```bash
agent-remnote --json stack takeover --channel dev
```

这会：

- 把 canonical claim 改成 `dev`
- best-effort 拉起 canonical `daemon + api + plugin`

## 切回 stable

```bash
agent-remnote --json stack takeover --channel stable
```

这会：

- 把 claim 改回 `stable`
- 停掉当前 dev bundle
- 如果配置了 stable launcher，则触发它

## 临时 stable launcher

当前还没有完全自动发现发布版 launcher。
本地如果要验证 reclaim 时真的去拉 stable，可以临时配：

```bash
export AGENT_REMNOTE_STABLE_LAUNCHER_CMD="$(command -v node)"
export AGENT_REMNOTE_STABLE_LAUNCHER_ARGS_JSON='["/path/to/stub-or-cli.js"]'
```

这是临时机制，后续会继续收口成默认发布安装态策略。
