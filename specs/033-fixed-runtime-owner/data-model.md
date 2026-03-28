# Data Model: 033-fixed-runtime-owner

日期：2026-03-28

## 1. RuntimeProfileResolution

代表一次 CLI 调用最终解析出来的运行时画像。

字段：

- `profile`
  - `stable`
  - `dev`
- `runtime_root`
  - 该 profile 的默认 artifact 根目录
- `control_plane_root`
  - 全局可发现的 control-plane 根目录
- `port_class`
  - `canonical`
  - `isolated`
- `install_source`
  - `published_install`
  - `source_tree`
- `repo_root`
  - source-tree 场景下的 repo/worktree 根路径
- `worktree_root`
  - 当前 worktree 根路径，用于 isolated dev 派生

## 2. RuntimeOwnerDescriptor

代表一个 live runtime 的 durable owner 身份。

字段：

- `owner_channel`
  - `stable`
  - `dev`
- `owner_id`
  - 稳定 owner 标识
- `install_source`
  - `published_install`
  - `source_tree`
- `runtime_root`
- `repo_root`
- `worktree_root`
- `port_class`
  - `canonical`
  - `isolated`
- `launcher_ref`
  - 对应的 owner launcher 标识
- `plugin_dist_origin`
  - plugin assets 的来源
- `source_stamp`
  - 用于区分不同 source worktree / source snapshot

## 3. FixedOwnerClaim

代表 fixed RemNote URL 的唯一 expected-owner truth source。

字段：

- `claimed_channel`
  - `stable`
  - `dev`
- `claimed_owner_id`
- `launcher_ref`
- `runtime_root`
- `control_plane_root`
- `port_class`
  - canonical fixed URL 对应的端口类，应为 `canonical`
- `updated_at`
- `updated_by`
  - `doctor_fix`
  - `stack_takeover`
  - `initial_bootstrap`
- `repo_root`
  - 当 `dev` 持有 fixed claim 时记录来源 repo
- `worktree_root`
  - 当 `dev` 持有 fixed claim 时记录具体 worktree

## 3a. OwnerLauncher

代表如何启动目标 owner。

字段：

- `launcher_ref`
- `kind`
  - `published_shim`
  - `source_worktree`
- `command`
- `args`
- `cwd`
- `env_overrides`
- `validation`
  - 如何确认 launcher 仍然可用

## 4. RuntimeArtifactSet

代表 daemon、api、plugin 三类后台工件中的一类 live 观察对象。

字段：

- `service`
  - `daemon`
  - `api`
  - `plugin`
- `pid_file`
- `state_file`
- `log_file`
- `pid`
- `build`
- `owner`
  - `RuntimeOwnerDescriptor`
- `running`
- `healthy`
- `trusted`
- `claimed`

说明：

- `trusted`
- `claimed`

这两个字段是读取时计算出的状态视图，不属于 pid/state 持久化契约。

## 5. OwnershipConflict

代表 claim 与 live 观察之间的冲突。

字段：

- `id`
  - 例如 `claim_missing`
  - `claim_stale`
  - `canonical_owner_mismatch`
  - `mixed_service_owners`
  - `ambiguous_live_occupant`
- `severity`
  - `warning`
  - `error`
- `claimed_owner`
  - `FixedOwnerClaim | null`
- `live_artifacts`
  - `RuntimeArtifactSet[]`
- `repairable`
  - 布尔值
- `repair_strategy`
  - `cleanup_only`
  - `restart_claimed_owner`
  - `manual_takeover_required`
  - `manual_investigation_required`

## 6. RepairDecision

代表 `doctor --fix` 的一次结构化 repair 结果。

字段：

- `decision_id`
- `changed`
- `ok`
- `claimed_owner_before`
- `claimed_owner_after`
- `actions`
  - cleanup stale artifact
  - rewrite canonical config
  - stop trusted mismatched owner
  - restart claimed owner
  - refuse transfer before plugin preflight
- `skipped_reason`

## 7. TakeoverRequest

代表显式 transfer。

字段：

- `target_channel`
  - `stable`
  - `dev`
- `source_profile`
  - 当前发起请求的 profile
- `repo_root`
  - dev takeover 时必填
- `worktree_root`
  - dev takeover 时必填
- `requires_remnote_reload`
  - 布尔值

## 8. TakeoverResult

代表 `stack takeover` 的结果。

字段：

- `previous_claim`
- `next_claim`
- `stopped_services`
- `restarted_services`
- `skipped_services`
- `failed_services`
- `remnote_reload_required`
- `warnings`
- `next_actions`

## 8a. DevBootstrapPolicy

代表 isolated dev profile 如何初始化控制信息。

字段：

- `shared_control_plane_config`
  - 是否读取全局 config
- `seed_workspace_bindings`
  - 是否受控 seed workspace binding
- `copy_queue_or_receipts`
  - 固定为 `false`

## 关系

- `RuntimeProfileResolution` 决定默认 `runtime_root` 与 `port_class`
- `RuntimeProfileResolution.control_plane_root` 决定 claim 与全局 config 的发现路径
- `FixedOwnerClaim` 是唯一 expected-owner truth source
- `RuntimeArtifactSet.owner` 是 live observation，不是 expected-owner source
- `OwnerLauncher` 为 claim/live owner 提供跨 profile 重启能力
- `OwnershipConflict` 来自 `FixedOwnerClaim` 与 `RuntimeArtifactSet[]` 的比较
- `RepairDecision` 只能处理 `repairable=true` 的冲突
- `TakeoverRequest` 会更新 `FixedOwnerClaim`，并驱动 canonical services 的 owner transfer
