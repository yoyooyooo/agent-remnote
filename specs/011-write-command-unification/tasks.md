# Tasks: Write Command Unification（write-first + 命令收口）

**Input**: Design documents from `specs/011-write-command-unification/`  
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `contracts/cli.md`

**Dependency Note**: `specs/013-multi-client-execution-safety/` 会改变写入链路的“回执确认/重试”基线（attempt_id + CAS ack）；本 spec 的 write-first 默认策略与错误恢复建议（nextActions）应与 013 的落地策略一致，避免引导用户走到不安全的重试路径。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件且无依赖）
- **[Story]**: `[US1]` / `[US2]` / `[US3]`
- 每条任务描述必须包含明确文件路径

---

## Phase 0: Spec & Design Artifacts（仅文档）

- [x] T000 创建 011 规格骨架：`specs/011-write-command-unification/{spec.md,plan.md,tasks.md,research.md,contracts/cli.md}`
- [x] T001 [US2] 在 `contracts/cli.md` 锁定 raw 入队收口策略为 Option B：`write advanced ops`（forward-only，不保留歧义）

---

## Phase 1: Raw Enqueue 收口（消除重复入口与默认值分叉）

- [x] T010 [US2] 新增 `write advanced ops` 命令（raw 入队唯一入口）：`packages/agent-remnote/src/commands/write/ops.ts` + wiring：`packages/agent-remnote/src/commands/write/advanced/index.ts`
- [x] T011 [US2] 删除 `apply` 与 `queue enqueue` 并更新 CLI wiring：`packages/agent-remnote/src/commands/index.ts`、`packages/agent-remnote/src/commands/queue/index.ts`
- [x] T012 [US2] raw 入队 contract tests：覆盖默认值策略（notify/ensure-daemon 默认 true）、输出 envelope 与错误码稳定：`packages/agent-remnote/tests/contract/**`

---

## Phase 2: write-first 诊断一致性（把 inspect 退为 next action）

- [x] T020 [US1] 为核心写入命令补齐失败诊断字段（`hint`/`nextActions`）与稳定错误码：`packages/agent-remnote/src/commands/write/{md.ts,bullet.ts}`、`packages/agent-remnote/src/commands/replace/text.ts`
- [x] T021 [US1] 写入命令 success 回执补齐可闭环信息（ids/txn/op）与 next actions：`packages/agent-remnote/src/commands/_enqueue.ts` + 调用点
- [x] T022 [US3] “典型失败” contract tests：无效 rem id / parent 缺失 / daemon 不可达 / payload shape 错误：`packages/agent-remnote/tests/contract/**`
- [x] T023 [US1] 为写入命令增加 `--wait/--timeout-ms`（内部等待 txn 终态，避免 Agent 重复写入来“重试确认”）：`packages/agent-remnote/src/commands/{write/*,daily/write.ts,replace/*}` + 复用 `queue wait` 语义
- [x] T024 [US1] `write --wait` contract tests：成功/超时/失败时的错误码稳定 + `nextActions[]` 可执行 + `--json` stdout 纯净：`packages/agent-remnote/tests/contract/**`

---

## Phase 3: Optional Collapse under `write`（更彻底的单入口）

- [x] T030 [US2] 同步更新脚本调用点（若存在）：`scripts/**`

---

## Phase 4: Doc Sync（实现落地后再做）

- [x] T040 [US2] 实现完成后同步 SSoT：`docs/ssot/agent-remnote/tools-write.md`（按用户要求，此任务可延后执行）
- [x] T041 [US2] 更新 `README.md` / `README.zh-CN.md` 的命令映射与推荐工作流

---

## Phase 5: Skill Sync（反哺 `$remnote`，实现收尾任务）

- [x] T050 [US2] 更新 `$remnote` 的命令选择标准与最短链路（write-first + 场景→命令映射 + raw 入队唯一入口裁决），同步调整“写入默认策略/低层原语/推荐 recipes”段落：`$CODEX_HOME/skills/remnote/SKILL.md`
- [x] T051 [US2] 若本 spec 删除/重命名命令（forward-only），同步移除 `$remnote` 中的旧命令示例与 recipes（例如 raw 入队的旧入口），避免 Agent 选到低效路径：`$CODEX_HOME/skills/remnote/SKILL.md`
- [x] T052 [US1] 同步 `$remnote`：默认 fire-and-forget（只入队，不等待）；仅当存在前后依赖（或用户明确要求确认落库）时启用 `--wait/--timeout-ms`，避免 backlog 场景下 Agent 陷入等待僵局：`$CODEX_HOME/skills/remnote/SKILL.md`
