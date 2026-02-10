# Contract: Testing Strategy（009 Effect Native Upgrade）

**Date**: 2026-01-25  
**Spec**: `specs/009-effect-native-upgrade/spec.md`

## Goal

把 009 的“Effect Native 化”重构与测试体系绑定在一起：每次改造都必须能用确定性的测试快速证明“新契约成立”，而不是依赖人工事前检查或真实 RemNote 环境。

## Test Taxonomy

1) **Contract tests（CLI / 外部契约）**
- 目标：锁定对外契约（尤其 `--json` / `--ids` / stderr 纯度 / exit code / 错误码）。
- 位置：`packages/agent-remnote/tests/contract/*.contract.test.ts`
- 原则：forward-only 允许 breaking change，但必须同步更新这些 tests 作为“新契约基线”（不做兼容层）。

2) **Unit tests（Services / Runtime 内部行为）**
- 目标：验证资源生命周期（acquireRelease/Scope）、超时/取消、节流/背压、以及错误通道的可诊断性。
- 位置：`packages/agent-remnote/tests/unit/*.unit.test.ts`
- 约束：尽量使用 `TestClock`/确定性调度，避免真实 `setTimeout` 造成 flaky。

3) **Integration-ish tests（受控集成）**
- 目标：在不依赖真实 RemNote 的前提下，验证“队列 → ws-bridge → 协议消息 → 结果落库/可观测”的关键闭环。
- 位置：`packages/agent-remnote/tests/integration/*.integration.test.ts`
- 建议：使用临时 queue db（temp file）+ 本地 ws server（或 stub）做最小闭环。

4) **Static gates（架构/原语门禁）**
- 目标：防止重构回退到“散落 timers / spawn / sync-fs / process-global config”。
- 位置：`packages/agent-remnote/tests/gates/module-boundaries.contract.test.ts` + 新增 primitive usage guard。

## Alignment Matrix（改造 ↔ 测试）

| Area | Primary change | Test type | Proposed test files | Key assertions |
|------|----------------|-----------|---------------------|----------------|
| Kernel portability | `kernel/**` 禁止 node/effect/平台依赖 | Static gates | `tests/gates/kernel-portability.contract.test.ts` | no forbidden imports/calls; allow explicit whitelist only |
| Config | flags/env/defaults 收口到 Effect Config | Unit + Contract | `config.unit.test.ts` / existing contract tests | precedence = `CLI flags > env > defaults`, path normalize, stable error codes |
| FileInput | `@file`/`-`/`~` 解析与大小限制收口 | Unit | `file-input.unit.test.ts` | parses sources, enforces size limit, returns actionable errors |
| Write-first output | 入队成功返回 `nextActions`；失败返回稳定 hint | Contract | `tests/contract/write-first.contract.test.ts` | `--json` single envelope & stderr empty; `--ids` stdout-only ids & stderr empty; `nextActions` contains inspect/progress |
| StatusLine | file mode + controller 节流/合并 | Unit + Contract | `status-line-controller.unit.test.ts` + existing status line contract tests | throttle respected; daemon unreachable still renders `↓N`; no stdout pollution |
| WsClient | connect/query/timeout 重写为 Effect | Unit | `ws-client.unit.test.ts` | timeout deterministic, sockets closed on interrupt, errors diagnosable |
| WS bridge runtime | internal → runtime actor，消息处理收口 | Integration-ish | `ws-bridge-runtime.integration.test.ts` | protocol validation; StartSync dispatch; state persistence invariants |
| Subprocess | timeout/kill/diagnostics 封装 | Unit | `subprocess.unit.test.ts` | kill on timeout, captures stdout/stderr, no leaked process |
| WorkerRunner | hard-timeout/terminate/diagnostics | Unit | `worker-runner.unit.test.ts` | terminate on timeout, no leaked worker, clear error codes |
| Supervisor | timer/callback → actor/schedule | Integration-ish | `supervisor.integration.test.ts` | start/stop is idempotent, pid/state/log semantics consistent |

## Determinism Rules (non-negotiable)

- 单测禁止依赖真实 wall-clock；必须优先用 `TestClock` 或可控 mock services。
- 严禁在测试里写入用户真实目录；需要文件时使用临时目录/临时文件。
- `--json` 输出的 tests 必须要求 `stderr === ''`（保持协议纯度）。
- `--ids` 输出的 tests 必须要求 `stdout` 仅包含 ids（每行一个）且 `stderr === ''`。
- `kernel/**` 单测不得使用 `Date.now()`；时间必须从 `Event.now` 输入（保证可控与可重放）。
