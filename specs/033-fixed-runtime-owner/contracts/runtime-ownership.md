# Contract: Runtime Ownership And Fixed URL Governance

日期：2026-03-28

## Source Hierarchy

本文件是 033 feature 的实现契约草案，用于锁定：

- fixed-owner claim 语义
- runtime profile / runtime root 语义
- ownership diagnostics contract
- explicit transfer surface

最终 authoritative global 落点应同步到：

- `docs/ssot/agent-remnote/cli-contract.md`
- `docs/ssot/agent-remnote/http-api-contract.md`
- `docs/ssot/agent-remnote/README.md`
- `docs/ssot/agent-remnote/ui-context-and-persistence.md`
- `packages/agent-remnote/README.md`

## Core Model

### 1. Stable Default

- canonical fixed URL 默认属于 `stable`
- canonical port class 对应用户已有的固定 RemNote URL
- stable published install 是默认 claim holder
- stable runtime root 继续等于当前 stable 用户态根，避免迁移现有用户数据

### 2. Dev Default

- source-tree invocation 默认进入 isolated `dev` profile
- isolated `dev` profile 不共享 stable runtime root
- isolated `dev` profile 不占用 canonical port class
- isolated `dev` profile 的 root 和 ports 按 `worktree_root` 派生
- isolated `dev` profile 读取 control-plane config，但不复制完整 stable store

### 3. Explicit Transfer

- 只有显式 transfer 才允许 `dev` 接管 canonical fixed URL
- transfer 通过 `stack takeover --channel <stable|dev>` 完成
- reclaim stable 通过 `stack takeover --channel stable` 完成
- fixed-owner bundle 明确包括 daemon + api + plugin

## Control-Plane Contract

### Canonical Roots

- `control_plane_root`：全局可发现，默认 `~/.agent-remnote`
- `stable_runtime_root`：继续等于当前 stable 用户态根
- `dev_runtime_root`：`<control_plane_root>/dev/<worktree-key>`

### Canonical Claim Path

- fixed-owner claim 必须位于 control-plane 子路径
- 不能要求先解析当前 runtime root 才能找到 claim
- `doctor`、`stack`、source worktree、packed install 都必须从同一 canonical path 读 claim

## Resolved Config Contract

`config print --json` 必须暴露至少以下字段：

- `runtime_profile`
- `runtime_root`
- `control_plane_root`
- `runtime_port_class`
- `install_source`
- `repo_root`
- `worktree_root`
- `resolved_local_owner`
- `fixed_owner_claim_file`
- `fixed_owner_claim`
- `ws_url`
- `api_base_url_effective`
- `plugin_base_url_effective`
- `daemon_pid_file_default`
- `daemon_log_file_default`
- `supervisor_state_file_default`
- `api_pid_file_default`
- `api_log_file_default`
- `api_state_file_default`
- `plugin_pid_file_default`
- `plugin_log_file_default`
- `plugin_state_file_default`

## Runtime Artifact Contract

daemon/api/plugin 的 pid/state metadata 必须至少包含：

- `owner_channel`
- `owner_id`
- `install_source`
- `runtime_root`
- `repo_root`
- `worktree_root`
- `port_class`
- `launcher_ref`
- `plugin_dist_origin`
- `source_stamp`
- `build`

说明：

- `build` 继续用于 runtime mismatch 诊断
- owner fields 用于 ownership mismatch 诊断
- status surfaces 同时展示两类信息，不能二选一

### Computed Status Fields

以下字段可以出现在 `doctor/status/config print` 的读取结果里，但不属于
pid/state 持久化契约：

- `trusted`
- `claimed`
- `matches_fixed_owner_claim`

## Fixed Owner Claim Contract

canonical claim 文件必须至少包含：

- `claimed_channel`
- `claimed_owner_id`
- `launcher_ref`
- `runtime_root`
- `control_plane_root`
- `repo_root`
- `worktree_root`
- `port_class`
- `updated_at`
- `updated_by`

语义：

- claim 只表达 expected owner
- claim 缺失时，系统 bootstrap 到 stable default
- claim stale 但 live owner 清晰时，`doctor --fix` 可以重写 claim
- claim 与 live owner 冲突且 target 明确时，`doctor --fix` 可以修
- claim 与 live owner 冲突但 target 不明确时，必须要求显式 transfer

## Launcher Contract

为了让 `stable` 可以从 source-side 操作中被可靠拉起，系统必须维护可验证的
launcher 语义。

最少字段：

- `launcher_ref`
- `kind`
- `command`
- `args`
- `cwd`
- `env_overrides`
- `validation_rule`

规则：

- stable launcher 必须能解析到 published install / Volta shim
- dev launcher 必须能解析到具体 source worktree
- `doctor --fix` 和 `stack takeover` 不能再默认复用当前调用进程的 entrypoint

## Status Contract

以下 surfaces 必须暴露 ownership 信息：

- `doctor --json`
- `stack status --json`
- `daemon status --json`
- `api status --json`
- `plugin status --json`

最少字段：

- `resolved_local`
  - `profile`
  - `runtime_root`
  - `owner`
- `fixed_owner_claim`
- `control_plane_root`
- `effective_endpoints`
- `services.daemon`
- `services.api`
- `services.plugin`
- `ownership_conflicts[]`
- `warnings[]`

说明：

- 不再要求模糊的顶层单值 summary，如 `runtime_profile`、`runtime_root`、
  `live_owner`、`repair_strategy`
- 当前调用方信息放在 `resolved_local.*`
- canonical expected-owner 信息放在 `fixed_owner_claim`
- live runtime 信息放在 `services.*`
- repair strategy 通过 `ownership_conflicts[]` 明确表达

## Doctor Contract

`doctor --json` 必须新增可结构化消费的 ownership checks：

- `runtime.fixed_owner_claim_present`
- `runtime.fixed_owner_claim_matches_live`
- `runtime.mixed_service_owners`
- `runtime.profile_root_collision`
- `runtime.canonical_port_owner_conflict`

`doctor --fix` 可做：

- stale pid/state cleanup
- stale claim cleanup or bootstrap
- canonical config rewrite
- trusted claimed-owner restart
- deterministic canonical owner realignment
- claimed owner launcher validation
- plugin artifact preflight for target dev takeover / restart

`doctor --fix` 不可做：

- 在 claim 不清楚时自动选 stable 还是 dev
- 杀死不可信或不可归属的 live occupant
- 修改 queue / `remnote.db` / 用户数据

作用域规则：

- `doctor --fix` 默认修 canonical fixed owner 的 deterministic 问题
- isolated dev profile 下执行也不能把作用域偷偷缩成“只修当前 profile”

## Transfer Contract

### Public Surface

唯一 mutation surface：

```bash
agent-remnote stack takeover --channel stable
agent-remnote stack takeover --channel dev
```

### Transfer Guarantees

- transfer 前必须读取 claim + live owner + trust state
- transfer 前必须完成 target launcher validation
- `--channel dev` 前必须完成 plugin artifact preflight
- transfer 只会让一个 owner 持有 canonical fixed URL
- transfer 结果必须报告：
  - `previous_claim`
  - `next_claim`
  - `stopped`
  - `restarted`
  - `failed`
  - `remnote_reload_required`

### Failure Rules

- 若 live owner 不可信，transfer 默认 fail-fast
- 若 target owner 无法启动，claim 不得 silently drift 到 broken final state
- 若 plugin asset provider 变化但需要 RemNote reload，结果必须显式提示
- 若 daemon/api/plugin 不能形成同一 owner bundle，transfer 不能报告成功

### Canonical Port Obedience

- `stack ensure/status/stop/takeover` 是 fixed-owner orchestration surface
- 直接调用 `daemon/api/plugin start|ensure` 只要目标是 canonical ports，也必须 obey claim policy
- isolated ports 下的 direct lifecycle commands 可按 local profile 运行

## Migration Semantics

- stable runtime root 继续保留当前 `~/.agent-remnote` stable 数据
- 现有 `config.json` 继续作为 control-plane config 保留
- 现有 stable `store.sqlite` 与 `workspace_bindings` 保留原位
- old stable pid/state/log artifacts 继续视为 stable runtime artifacts
- isolated dev 首次启动不得复制 queue、receipts、历史运行态
- isolated dev 只允许读取全局 control-plane config，并受控 seed 必要的 workspace binding hints

## Verification Contract

实现完成前必须具备：

- profile/root resolution contract tests
- ownership metadata serialization tests
- claim-vs-live conflict detection tests
- doctor deterministic repair tests
- `stack takeover --channel dev|stable` contract tests
- one lifecycle integration test:
  - bootstrap stable
  - isolated dev start
  - dev takeover
  - stable reclaim
- one packed-install + source-tree coexistence test using existing packed-cli helpers
