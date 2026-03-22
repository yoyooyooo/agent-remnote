# Data Model: 030-remnote-business-command-mode-parity

日期：2026-03-22

## 1. RemNoteBusinessCommand

代表一个需要被 inventory 管理的 command-level surface。

字段：

- `id`
  - 稳定命令标识，例如 `rem.create`、`portal.create`
- `family`
  - 所属命令家族
- `classification`
  - `business`
  - `business_deferred`
  - `operational_host_only`
- `wave`
  - `wave1`
  - `wave2`
  - `wave3`
  - `excluded`
- `parity_target`
  - `same_support`
  - `same_stable_failure`
  - `reclassify`
- `host_semantics`
  - 依赖的宿主事实语义集合
- `verification_case_ids`
  - 对应的 success/failure 验证用例

## 2. AuthoritativeCommandInventory

代表唯一 authoritative inventory。

字段：

- `source_path`
  - `docs/ssot/agent-remnote/runtime-mode-and-command-parity.md`
- `commands`
  - `RemNoteBusinessCommand[]`
- `derivative_artifacts`
  - feature-local parity ledger
  - code-side machine-readable mirror
  - executable command-contract registry
  - classification / contract / architecture tests

## 3. Wave1CommandContract

代表一个 Wave 1 parity-mandatory 命令的可执行契约行。

字段：

- `command_id`
- `family`
- `parity_target`
- `required_capabilities`
  - 该命令运行前必须具备的 runtime capability
- `local_use_case`
  - local adapter 调用的 use case 名称或模块
- `remote_endpoint`
  - remote adapter 调用的 Host API endpoint
- `success_normalizer`
  - 用于 direct-vs-remote comparison 的成功结果归一化器
- `stable_failure_normalizer`
  - 用于 direct-vs-remote comparison 的失败结果归一化器
- `verification_case_ids`
  - 对应的命令级验证用例

## 4. CommandContractRegistry

代表 Wave 1 executable registry。

字段：

- `source_path`
  - `packages/agent-remnote/src/lib/business-semantics/commandContracts.ts`
- `contracts`
  - `Wave1CommandContract[]`
- `bounded_by`
  - `AuthoritativeCommandInventory`
- `drift_checks`
  - inventory -> registry 对齐测试
  - registry -> verification mapping 对齐测试

## 5. ModeParityRuntime

代表唯一允许做 mode switch 的业务运行时。

字段：

- `mode`
  - `local`
  - `remote`
- `adapter`
  - 当前绑定的 mode adapter
- `capabilities`
  - runtime 暴露给命令层的能力集合
- `transport_context`
  - baseUrl / basePath / timeout diagnostics 等 transport 信息

## 6. RuntimeCapability

代表 `ModeParityRuntime` 暴露的一项业务能力。

字段：

- `id`
  - 例如 `resolve_ref`, `resolve_placement`, `selection_current`,
    `plugin_current`, `read_outline`, `write_apply`, `queue_wait`
- `owner_semantics`
  - 对应的 host-authoritative semantic 模块
- `local_adapter_impl`
  - local adapter 的实现入口
- `remote_adapter_impl`
  - remote adapter 的实现入口
- `normalizer`
  - comparison 时使用的归一化规则
- `failure_contract`
  - 该 capability 失败时的稳定错误语义

## 7. HostSemanticCapability

代表一个必须由 host-authoritative 层统一提供的业务语义能力。

字段：

- `id`
  - 例如 `ref_resolution`, `placement_resolution`, `selection_resolution`
- `scope`
  - 哪些命令依赖该能力
- `authoritative_owner`
  - 最终 authoritative implementation 的模块或 use case
- `current_sources`
  - 当前散落实现的文件位置
- `failure_contract`
  - 该能力失败时应返回的稳定错误语义

## 8. VerificationCase

代表 remote-first gate 中的一个命令级验收单元。

字段：

- `id`
- `command_id`
- `case_kind`
  - `success`
  - `stable_failure`
- `mode`
  - `local`
  - `remote`
- `api_base_path`
  - `/v1`
  - `/remnote/v1`
- `fixture_ids`
  - hierarchy / selection / ui_context / receipt / transport fixture
- `comparison_scope`
  - 哪些字段必须一致
- `transport_ignored_fields`
  - 哪些字段允许不同

## 9. ParityGap

代表当前实现与目标 parity contract 的差距。

字段：

- `command_id`
- `gap_type`
  - `docs_gap`
  - `classification_gap`
  - `executable_contract_gap`
  - `runtime_spine_gap`
  - `host_semantic_leak`
  - `missing_host_api_surface`
  - `local_only_behavior`
  - `verification_gap`
- `severity`
  - `blocking`
  - `high`
  - `medium`
- `target_fix_phase`
- `evidence`

## 关系

- `AuthoritativeCommandInventory` 是唯一权威源
- `CommandContractRegistry` 受 `AuthoritativeCommandInventory` 约束，不能独立发明 command
- `DerivedParityLedger` 从 `AuthoritativeCommandInventory` 派生
- `ModeParityRuntime` 暴露多个 `RuntimeCapability`
- `Wave1CommandContract` 依赖一个或多个 `RuntimeCapability`
- `RemNoteBusinessCommand` 依赖零个或多个 `HostSemanticCapability`
- `RemNoteBusinessCommand` 对应一个或多个 `VerificationCase`
- `ParityGap` 挂在单个 command 或单个 runtime spine 缺口上，而不是只挂在 family 上
