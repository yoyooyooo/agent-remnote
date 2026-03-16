# 实施计划：023-rem-replace-surface

日期：2026-03-16  
Spec：`specs/023-rem-replace-surface/spec.md`

## 摘要

本特性采用**单一 canonical replace 命令 + 参数化 target selector + 参数化 surface** 的路线推进。

目标是把现有 replace 语义统一收敛到 `agent-remnote rem replace`：

- 用 `--selection` 和重复 `--rem` 表达“替换谁”
- 用 `--surface children|self` 表达“替换哪一层”
- 保留现有 runtime primitive，不重做底层执行链
- 把旧 replace 入口降为非 canonical surface，并在文档与 skill 中退出第一推荐路径

## 技术背景

- **Language/Version**: TypeScript ESM on Node.js
- **Primary Dependencies**: `effect`, `@effect/cli`, existing Host API client and queue/apply pipeline
- **Storage**: Store DB / queue DB / RemNote plugin runtime already exist; this feature does not introduce new persistent storage
- **Testing**: Vitest contract tests and unit tests in `packages/agent-remnote/tests/**`
- **Target Platform**: Local CLI, remote-mode CLI via Host API, existing RemNote plugin executor
- **Project Type**: Monorepo with `packages/agent-remnote` and `packages/plugin`
- **Performance Goals**: No meaningful runtime hot-path change; command dispatch and validation must stay within existing CLI-scale latency expectations
- **Constraints**:
  - No direct `remnote.db` writes
  - No mandatory preflight inspect step
  - Command surface changes must be explicit and docs-first by feature close
  - `--surface self` must not reintroduce local-only semantics when target resolution can be done through explicit ids or Host API-backed selection
- **Scale/Scope**: CLI contract and guidance unification for replace workflows only; no queue/protocol redesign

## Constitution Check

| Constraint | Result | Notes |
| --- | --- | --- |
| No direct writes to `remnote.db` | PASS | Public command routing changes only; all writes stay on queue -> WS -> plugin SDK. |
| Forward-only evolution | PASS | Command-surface changes are explicit in this spec and will be reflected in SSoT/docs. |
| SSoT priority | PASS | Plan includes synced updates to `docs/ssot/agent-remnote/**` and README surfaces. |
| Budgets and timeout guardrails | PASS | No new blocking substrate is introduced; existing wait/timeout behavior stays in place. |
| Unique consumer and diagnosable identity | PASS | No queue-consumer or WS-identity behavior changes. |
| Cross-platform paths | PASS | Markdown input continues to use existing input-spec handling. |
| User-visible English output | PASS | CLI help, errors, and diagnostics remain English. |
| Local verifiability | PASS | Contract tests and help tests will gate the new surface. |
| Non-destructive defaults | PASS | `surface=children` with empty markdown clears children only; `surface=self` follows explicit replace semantics. |
| Single-purpose state files | PASS | No new state-file semantics are introduced. |
| Enforceable boundaries | PASS | Contract/help tests can gate canonical and non-canonical command surfaces. |
| Write-first | PASS | `rem replace` becomes a direct write command, with validation in-command. |
| Agent skill sync | PASS | Final workstream includes `$remnote` skill update. |

## Perf Evidence Plan

N/A

原因：本特性聚焦命令契约、参数编译与帮助面，不触及性能敏感热路径，也不引入新的自动策略。

## 项目结构

### Documentation

```text
specs/023-rem-replace-surface/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── cli.md
└── tasks.md
```

### Source Code

```text
packages/agent-remnote/src/commands/write/rem/
├── index.ts
├── replace.ts                      # new canonical entry
└── children/
    ├── index.ts
    ├── replace.ts                  # legacy/non-canonical wrapper candidate
    └── common.ts

packages/agent-remnote/src/commands/write/replace/
├── index.ts
├── block.ts                        # advanced/local-only legacy surface
└── _target.ts

packages/agent-remnote/src/kernel/write-plan/
└── compile.ts                      # action -> op compilation

packages/agent-remnote/src/kernel/op-catalog/
└── catalog.ts                      # op metadata stays aligned

packages/agent-remnote/tests/contract/
├── rem-children-replace-selection.contract.test.ts
├── replace-block.contract.test.ts
├── help.contract.test.ts
└── invalid-options.contract.test.ts

docs/ssot/agent-remnote/
├── cli-contract.md
├── tools-write.md
└── http-api-contract.md
```

**结构裁决**：

- 新 canonical surface 放在 `packages/agent-remnote/src/commands/write/rem/replace.ts`
- 现有 `rem children replace` 和 `replace markdown` 只作为迁移/advanced surface 继续评估，不再占据 canonical 位置
- runtime primitive 继续复用：
  - `replace_children_with_markdown`
  - `replace_selection_with_markdown`

## Phase 0：Research & Decisions

目标：把命令面裁决、迁移边界、参数兼容矩阵先定死，避免写实现时来回摇摆。

交付：

- `research.md`

需要定下的决策：

1. canonical command 统一为 `rem replace`
2. `selection` 保持 target selector 身份，不进入 command noun
3. `surface` 作为公开参数表达 replace 作用层
4. `preserve-anchor` 只适用于 `surface=children`
5. 旧 surface 的定位与收口方式

## Phase 1：Command Contract & Data Model

目标：把 `rem replace` 的请求模型、校验规则、公开 CLI 契约写成单一事实源。

交付：

- `data-model.md`
- `contracts/cli.md`
- `quickstart.md`

核心裁决：

- target selector：
  - repeated `--rem`
  - `--selection`
- replace surface：
  - `children`
  - `self`
- surface-specific validation：
  - `children` 要求 exactly one target
  - `self` 默认要求 same parent + contiguous
- assertion profile：
  - `preserve-anchor` 仅限 `children`

## Phase 2：Implementation Workstreams

### Workstream A：Canonical CLI Surface

目标：新增 `rem replace` 并把它设为 canonical replace family。

交付：

- `packages/agent-remnote/src/commands/write/rem/replace.ts`
- `packages/agent-remnote/src/commands/write/rem/index.ts`

要点：

- 命令签名围绕 `rem replace` 展开
- target selector 与 surface 校验在命令层 fail-fast
- 公共等待参数、输入参数、输出 envelope 复用既有写入约定

### Workstream B：Compilation Routing

目标：把 canonical command 稳定编译到现有 primitive，而不复制执行逻辑。

交付：

- `packages/agent-remnote/src/kernel/write-plan/compile.ts`
- 可能的共享 helper 调整

要点：

- `surface=children` -> `replace_children_with_markdown`
- `surface=self` -> `replace_selection_with_markdown`
- repeated `--rem` 要转成 explicit target set
- `--selection` 在 local / remote mode 下都要走统一 target resolution 语义

### Workstream C：Legacy Surface Demotion

目标：把旧 replace surface 明确降为非 canonical，而不是和新 surface 并列推荐。

交付：

- `packages/agent-remnote/src/commands/write/rem/children/replace.ts`
- `packages/agent-remnote/src/commands/write/replace/block.ts`
- 帮助文案与错误提示更新

裁决：

- `rem children replace` 保留现有语义，但在 docs/help 中标记为 legacy wrapper 或 compatibility surface
- `replace markdown` 保留 advanced/local-only 定位
- 旧 surface 不再作为 `$remnote` skill 的第一推荐路径

### Workstream D：Contracts, Docs, Skill Sync

目标：让代码面、SSoT、README 和 skill 采用同一套 vocabulary。

交付：

- `docs/ssot/agent-remnote/cli-contract.md`
- `docs/ssot/agent-remnote/tools-write.md`
- `docs/ssot/agent-remnote/http-api-contract.md`
- `README.md`
- `README.zh-CN.md`
- `README.local.md`
- `~/.codex/skills/remnote/SKILL.md`

关键同步点：

- canonical path: `rem replace`
- target selector: `--selection` / repeated `--rem`
- replace surface: `--surface children|self`
- non-canonical / advanced surface positioning for older commands

### Workstream E：Verification Gates

目标：用最小但足够硬的测试锁住新命令面。

交付：

- contract tests for:
  - `rem replace --surface children`
  - `rem replace --surface self`
  - repeated `--rem`
  - `--selection`
  - invalid selector/surface/assertion combinations
  - help output and canonical examples
- updated legacy-surface contract expectations where necessary

建议覆盖：

1. `surface=children` + one target succeeds in dry-run
2. `surface=children` + multiple targets fails fast
3. `surface=self` + explicit repeated `--rem` compiles to block replace op
4. `surface=self` + `--assert preserve-anchor` fails fast
5. remote-mode `--selection` and explicit ids route correctly when target semantics permit

## 实施顺序

1. Phase 0 研究与裁决落盘
2. Phase 1 产出 `data-model.md`、`contracts/cli.md`、`quickstart.md`
3. 新增 `rem replace` canonical command
4. 接线编译层与 target resolution
5. 降级旧 replace surface 的帮助面与文档定位
6. 文档、skill、contract tests 同步收口

## 风险与缓解

### 风险 1：旧 surface 和新 surface 并存导致用户困惑

缓解：

- canonical docs 只首推 `rem replace`
- 旧命令帮助面明确标注 legacy 或 advanced
- skill 只保留新命令 recipes

### 风险 2：`surface=self` 语义与旧 `replace markdown` 存在边界错位

缓解：

- `contracts/cli.md` 明确 public subset
- advanced-only selector 继续留在旧命令，避免一次把所有 block-replace 变体塞进 canonical path

### 风险 3：remote mode 对 target resolution 的支持不一致

缓解：

- plan 中明确只支持“可通过 explicit ids 或 Host API-backed selection 解析”的 target selector
- 任何仍依赖本地-only resolution 的 selector 继续留在 advanced/local-only surface

## Complexity Tracking

当前无需要单独豁免的 Constitution 违规项。
