# 契约：验证矩阵

日期：2026-03-22

## 验证类别

- selector schema drift
- scenario schema drift
- builtin preset catalog drift
- command taxonomy drift
- local / remote selector parity
- local / remote scenario parity
- selector/action compilation integration
- performance benchmark gate
- docs drift

## 目标结果

031 必须继续沿用 030 建立的 `inventory -> contract -> verification` 治理纪律。

## Gate 分层

### Always-on

- 只要 031 工件存在，就必须具备：
  - schema drift
  - tooling drift
  - builtin catalog drift
  - shared boundary drift
  - 031 spec set docs drift

### Promotion-gated

- 只有当某个 surface 被提升为 public / parity target 时，才允许开启对应 gate。
- `scenario.run` 的 local / remote parity gate 只能在以下前置条件全部满足后启用：
  - authoritative inventory 已收录 `scenario.run`
  - CLI contract 已收录 `scenario` 顶层命令与输入面
  - Host API contract 已冻结对应 remote execution surface
  - verification-case registry 与 executable contract registry 已补齐
- powerup metadata 的 public business route gate 只能在：
  - `powerup list/resolve/schema` 被提升出 deferred remote failure 状态
  - authoritative inventory 与 Host API public routes 已同步
  后再启用。

### Benchmark-gated

- 只有在 benchmark fixture、采样方式、通过阈值已冻结后，性能 gate 才能作为 implement gate。
- 在量化门禁冻结前，只允许保留 smoke / regression 级验证。

## 建议矩阵

| 维度 | Contract Test | Integration Test | Gate Level | 前置条件 | 目标 |
|---|---|---|---|---|---|
| Schema | `scenario-package-schema` | `scenario-schema-roundtrip` | always-on | 无 | schema 无歧义、可规范化 |
| Tooling | `scenario-schema-validate/normalize/explain/scaffold/generate` | `tooling-e2e` | always-on | `ScenarioSchemaToolResult` 与 hint schema 已冻结 | 子命令形成创建闭环 |
| Catalog | `builtin-preset-catalog-drift` | `builtin-preset-smoke` | always-on | builtin catalog entry shape 已冻结 | 内置集合稳定、可审计 |
| Taxonomy | `command-taxonomy` | `help-taxonomy-smoke` | always-on | canonical / alias 规则已冻结 | canonical / alias 不漂移 |
| Command Promotion | `inventory-mirror-drift` + `verification-case-registry-drift` | `root-command-smoke` | promotion-gated | 新命令进入 authoritative inventory | 新 family 不脱离治理链 |
| Selector | `query-ast-v2` | `selector-local-remote-parity` | partial | Query V2 body contract 已冻结；若涉及 powerup metadata，还需 authoritative metadata path 已冻结 | selector 语义 local / remote 一致 |
| Execution Preflight | `selector-action-compilation` + `scenario-execution-plan-contract` | `scenario-plan-roundtrip` | always-on | `ScenarioExecutionPlanV1`、lowering 规则、phase invariant 已冻结 | 场景执行模型可校验、可诊断 |
| Execution Public | `stable-scenario-run-contract` | `scenario-local-remote-parity` | promotion-gated | `scenario.run` 已进入 public inventory / CLI / Host API | 场景执行全链路一致 |
| Scheduling | `scheduling-policy-contract` + `hint-lowering-contract` + `silent-batching-contract` + `conflict-class-parity-contract` | `scenario-batch-merge-smoke` + `scalar-to-bulk-lowering-smoke` + `ordering-parity-under-conflict_parallel` | partial | lowering map、server/plugin conflict class 关系已冻结 | 调度 hints 稳定，silent batching 不要求 caller 改写 surface |
| Performance | `benchmark-fixture-drift` | `scenario-benchmark-gate` | benchmark-gated | baseline、采样方式、阈值已冻结 | 吞吐和往返优化可量化回归 |
| Shared | `shared-subpackage-boundary` | `shared-runtime-boundary-smoke` | always-on | shared exports 与 host boundary 已冻结 | shared 不泄漏宿主依赖，host 不复制 canonical schema |
| Failure | `stable-failure-contract` | `stable-failure-parity` | partial | 对应 public surface 已冻结；未 promotion 的 surface 只校验 stable local failure / remote refusal | 宿主边界失败稳定 |
| Docs | `docs-drift` | 无需单独 integration | always-on | 031 spec set 与传播清单已列明 | 文档与 contract 同步 |

## 量化 gate 最小要求

- benchmark gate 至少要冻结：
  - fixture 名称与数据规模
  - 采样轮次
  - 统计口径
  - 通过阈值
- 031 推荐至少跟踪三类指标：
  - `compiled_action_count`
  - `queue_ops_enqueued`
  - `wall_clock_ms`
- benchmark gate 必须声明对照基线：
  - 当前实现基线
  - 031 目标阈值
  - 允许波动范围

## 非目标 guard

- 不允许用“reserved surface”承接 public parity gate。
- 不允许缺失 authoritative inventory mirror 却宣称 command taxonomy 已可 gate。
- 不允许缺失 benchmark 阈值却宣称性能目标已通过自动化验证。
