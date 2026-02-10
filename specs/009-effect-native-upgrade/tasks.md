# Tasks: Effect Native Upgrade（全链路 Effect Native 化）

**Input**: Design documents from `specs/009-effect-native-upgrade/`  
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/*`, `quickstart.md`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件且无依赖）
- **[Story]**: `[US1]` / `[US2]` / `[US3]`
- 每条任务描述必须包含明确文件路径

---

## Phase 0: Spec & Design Artifacts（仅文档，允许先完成）

- [x] T000 创建 spec 目录与文档骨架：`specs/009-effect-native-upgrade/**`
- [x] T007 测试策略契约：补齐 contract/unit/integration-ish/static gates 的对齐矩阵：`specs/009-effect-native-upgrade/contracts/testing-strategy.md`
- [x] T007a 裁决并固化“可移植内核 + Actor 解释器”契约：`specs/009-effect-native-upgrade/contracts/portable-kernel-and-actors.md`

---

## Phase 1: Foundational（分层与边界门禁）

- [x] T001 [US2] 定义并落地分层骨架：`packages/agent-remnote/src/{runtime,kernel}/**`（仅骨架，不改行为）
- [x] T002 [US2] 更新边界门禁契约：`packages/agent-remnote/tests/gates/module-boundaries.contract.test.ts`（允许 runtime 依赖 Effect；kernel 禁止 node/effect；internal 视为 legacy 禁止新增）
- [x] T003 [US2] 建立静态门禁：primitive usage guard + kernel portability guard：`packages/agent-remnote/tests/gates/**` 或 `scripts/**`
- [x] T004 [US2] 收口“文件输入/路径解析”为单一 Service：`packages/agent-remnote/src/services/FileInput.ts`（支持 `@file` / `-` / `~` 展开与 normalize、大小上限与错误码），并改造调用点：`packages/agent-remnote/src/commands/write/md.ts`、`packages/agent-remnote/src/commands/daily/write.ts`、`packages/agent-remnote/src/commands/replace/block.ts`（以及其它仍直接 `fs.readFile(...)` 的命令）。
- [x] T005 [US2] 禁止通过 `process.env = ...` 注入配置：移除 daemon 启动路径中的 queue db env 注入，并改为显式传参（queue db path / state file path）：`packages/agent-remnote/src/commands/ws/{serve,start}.ts` +（迁移后）`packages/agent-remnote/src/services/**` + `packages/agent-remnote/src/runtime/ws-bridge/**`
- [x] T006 [US2] 收口 env/flags 到 Effect `Config`：在 `packages/agent-remnote/src/services/Config.ts` 用 `effect/Config` 描述 schema（含 env key 映射/默认值/校验/路径 normalize），并在 `packages/agent-remnote/src/main.ts` 通过 `Effect.withConfigProvider` 安装 provider（优先级 `CLI flags > env > defaults`），调用方仅依赖 `ResolvedConfig`（禁止散落 `process.env.*` 读取）。
- [x] T008 [US2] Config 单测：覆盖优先级（flags/env/defaults）、路径 normalize、错误码稳定：`packages/agent-remnote/tests/unit/config.unit.test.ts`
- [x] T009 [US2] FileInput 单测：覆盖 `@file` / `-` / `~` 展开、大小上限、可诊断错误：`packages/agent-remnote/tests/unit/file-input.unit.test.ts`

---

## Phase 2: StatusLine File Mode（收口 + 事件驱动 + fallback）

- [x] T010 [US1] 新增 statusLine 缓存文件协议与默认路径：`packages/agent-remnote/src/services/StatusLineFile.ts`
- [x] T011 [US1] 新增 statusLine kernel（渲染/合并决策）并实现 `StatusLineController` Actor：`packages/agent-remnote/src/kernel/status-line/**` + `packages/agent-remnote/src/runtime/status-line/**`
- [x] T012 [US1] tmux 刷新收口为 Effect service：`packages/agent-remnote/src/services/Tmux.ts`
- [x] T013 [US1] CLI enqueue 路径发布 `QueueEnqueued` 并触发 statusLine 更新（daemon 优先，失败 fallback）：`packages/agent-remnote/src/commands/_enqueue.ts`
- [x] T014 [US1] 新增 statusLine contract tests（覆盖 daemon 不可达时仍显示 `WSx`/`↓N`）：`packages/agent-remnote/tests/**`
- [x] T015 [US1] StatusLineFile 单测：路径解析/写入语义/幂等更新：`packages/agent-remnote/tests/unit/status-line-file.unit.test.ts`
- [x] T016 [US1] StatusLineController 单测：事件合并 + 节流（TestClock，避免 flaky）：`packages/agent-remnote/tests/unit/status-line-controller.unit.test.ts`

---

## Phase 3: WS bridge Effect 化（长驻 runtime Actor）

- [x] T020 [US3] 提取 ws-bridge kernel（协议/选举/状态机）并实现 runtime Actor：`packages/agent-remnote/src/kernel/ws-bridge/**` + `packages/agent-remnote/src/runtime/ws-bridge/**`
- [x] T021 [US3] 心跳/踢人/超时/状态文件写入节流全部迁移到 Effect（替换 setInterval/setTimeout）
- [x] T022 [US3] 所有关键点发布 runtime events（selection/uiContext/dispatch/ack）并驱动 statusLine invalidate；如需要，引入 `StatusLineInvalidate` WS 消息并同步更新 SSoT：`docs/ssot/agent-remnote/ws-bridge-protocol.md`
- [x] T023 [US3] ws-bridge 受控集成测试：协议处理/版本校验/StartSync 触发语义：`packages/agent-remnote/tests/integration/ws-bridge-runtime.integration.test.ts`

---

## Phase 4: 外围 IO Effect 化（WsClient / subprocess / worker / log）

- [x] T030 [US2] WsClient：用 Effect acquireRelease + timeout + Deferred 重写：`packages/agent-remnote/src/services/WsClient.ts`
- [x] T031 [US2] 抽出 SubprocessRunner（超时/输出/kill/诊断）：`packages/agent-remnote/src/services/Subprocess.ts` 并接入 `commands/wechat/outline.ts`
- [x] T032 [US2] 抽出 WorkerRunner（硬超时/terminate/诊断）：`packages/agent-remnote/src/services/WorkerRunner.ts` 并接入 `packages/agent-remnote/src/internal/remdb-tools/searchRemOverview.ts`（legacy 存量；迁移时应改为 `kernel/**` + `services/**`，避免继续扩大 internal）
- [x] T033 [US2] LogWriter：迁移到 Effect 调度或明确边界与收口：`packages/agent-remnote/src/services/LogWriter.ts`
- [x] T034 [US2] Supervisor：提取 kernel 状态机并去掉 timer/callback 中的 `Effect.runPromise(...)` 与散落 setTimeout，改为 runtime Actor + Effect 调度：`packages/agent-remnote/src/kernel/supervisor/**`、`packages/agent-remnote/src/commands/ws/supervisor.ts`、`packages/agent-remnote/src/runtime/supervisor/**`（必要时新增 `services/ChildProcess.ts`/`services/Clock.ts`）。
- [x] T035 [US2] WsClient 单测：timeout/interrupt/资源释放（TestClock）：`packages/agent-remnote/tests/unit/ws-client.unit.test.ts`
- [x] T036 [US2] SubprocessRunner 单测：超时 kill + 输出诊断：`packages/agent-remnote/tests/unit/subprocess.unit.test.ts`
- [x] T037 [US2] WorkerRunner 单测：硬超时 terminate + 诊断字段：`packages/agent-remnote/tests/unit/worker-runner.unit.test.ts`
- [x] T038 [US2] Supervisor 受控集成测试：start/stop 语义与状态文件一致性：`packages/agent-remnote/tests/integration/supervisor.integration.test.ts`

---

## Phase 5: 文档与验收

- [x] T040 [US1] 更新 `docs/ssot/agent-remnote/**` 中与实现锚点相关的部分（若目录迁移导致锚点漂移）
- [x] T041 [US1] 更新 `README.md` / `README.zh-CN.md`（如影响到 daemon/statusLine 的用法说明）
- [x] T042 跑 `specs/009-effect-native-upgrade/quickstart.md` 的验收清单并补齐缺口
- [x] T043 [US1] 增量增强 `agent-remnote config print`：输出 statusLine 文件、pid/log/state 文件等最终解析结果，便于排障与脚本固化：`packages/agent-remnote/src/commands/config/print.ts`
- [x] T044 [US1] 可选：增加 dist 产物 smoke gate（验证资源加载/入口可用）：`packages/agent-remnote/package.json`（或新增 `scripts/smoke-dist.ts`）并在 `quickstart.md` 里记录如何跑
- [x] T045 [US1] Write-first 写入链路契约：写入命令成功返回 `nextActions`（英文命令），失败返回稳定错误码与可修复提示；严格保持 `--json` stderr 为空与 `--ids` stderr 为空，并把该契约写入 `docs/ssot/agent-remnote/tools-write.md` 与相关 contract tests

---

## Phase 6: Follow-ups（反哺 Skill）

> 仅在 009 实施稳定后执行：把“本仓落地证据”回写到 `$effect-best-practices`，避免 Skill 与真实工程漂移。

- [x] T050 [P] 同步补充 CLI 工程模板：global option 严格预检、禁止 env 注入配置、file spec 统一解析、架构边界静态门禁（参考本仓实现与 tests）：`$CODEX_HOME/skills/effect-best-practices/references/cli-contract.md`
- [x] T051 [P] 同步补充测试范式：把“架构边界 contract tests / primitive usage guard”固化为推荐门禁：`$CODEX_HOME/skills/effect-best-practices/references/testing-effect.md`
- [x] T052 [P] 同步补充资源与调度：避免 timer/callback 里 `Effect.runPromise`，用 Actor + Scope 管理长驻循环：`$CODEX_HOME/skills/effect-best-practices/references/scope-resources.md`
- [x] T053 [P] 同步补充“可移植内核范式”：`reduce(state,event)->cmds` + Actor interpreter + 时间/ID 注入 + 静态门禁模板：`$CODEX_HOME/skills/effect-best-practices/references/advanced-index.md`（或新增专章并在 index 链接）

---

## Phase 7: Performance Baseline（补齐 NFR-004 量化证据）

- [x] T060 [NFR-004] 新增可重复的基准脚本（无外部工具依赖），覆盖 CLI startup/入队/ws health/search-plugin/daemon status：`packages/agent-remnote/scripts/bench-nfr-004.ts`、`packages/agent-remnote/package.json`
- [x] T061 [NFR-004] 生成并落盘基线结果（json + md），记录运行环境与命令参数：`specs/009-effect-native-upgrade/performance-baseline.json`、`specs/009-effect-native-upgrade/performance-baseline.md`
- [x] T062 [NFR-004] 更新验收矩阵：将 NFR-004 从 PARTIAL 升级为 PASS，并引用基线证据：`specs/009-effect-native-upgrade/acceptance.md`

---

## Phase 8: Hardening（可选：收紧门禁/提升回归发现能力）

- [x] T063 [US2] 收紧 primitive allowlist：审查并缩小门禁白名单（仅保留确有必要的例外），并在门禁/验收中记录理由：`packages/agent-remnote/tests/gates/primitive-usage.contract.test.ts`、`specs/009-effect-native-upgrade/acceptance.md`
- [x] T064 [US2] 可选：将 NFR-004 基线提升为“可开关的硬门禁”（默认关闭，避免 CI/机器差异误报），并固化阈值策略与诊断输出：`packages/agent-remnote/scripts/bench-nfr-004.ts`、`packages/agent-remnote/package.json`、`specs/009-effect-native-upgrade/performance-baseline.md`
