# Feature Specification: Merge core into agent-remnote (module reorg)

**Feature Branch**: `[008-agent-module-reorg]`  
**Created**: 2026-01-24  
**Status**: Accepted  
**Accepted**: 2026-01-26  
**Input**: User description: "合并 packages/core 到 packages/agent-remnote，并对 agent-remnote 内部目录/模块进行一次不计成本的面向未来重组（功能不变）。要求：1）保证现有 CLI/daemon/queue/read/write 等功能与对外契约不变；2）给出面向未来的架构说明与拆分路线图：当规模变大后应如何抽出真正硬的子包，并把该规划补充到 docs 文档中。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - CLI 用户/Agent 无感升级（功能不变） (Priority: P1)

作为 `agent-remnote` 的使用者（人类或上层 Agent/脚本），我希望在完成一次大规模目录与模块重组（包含将 `core` 合并进来）之后，所有既有命令依然能以相同方式工作，并遵守既有 CLI/协议契约。

**Why this priority**: 这是实施阶段的底线；一旦行为变化会破坏已有工作流与集成，重组将失去意义。

**Independent Test**: 仅通过现有自动化契约测试/回归检查即可独立验收（无需新增功能）。

**Acceptance Scenarios**:

1. **Given** 一份当前仓库的有效安装与环境，**When** 运行现有的 CLI 契约测试与基础回归检查，**Then** 全部通过且不需要用户改变使用方式。
2. **Given** 在 `--json` 模式下的成功/失败场景，**When** 执行任意既有命令，**Then** stdout 仍保持单行 JSON envelope，stderr 仍保持为空，并且 exit code 语义保持不变。

---

### User Story 2 - 维护者能快速定位能力与边界 (Priority: P2)

作为仓库维护者，我希望把“队列/WS bridge/只读 DB 工具/CLI 编排/运维守护”等能力在 `agent-remnote` 内部一次性重组为清晰的模块边界（data-model），让新增与维护工作能沿着稳定边界推进，而不是在命令代码里到处穿透。

**Why this priority**: 当前 `core` 的边界偏软（直引源码、env 透传、重复工具），重组如果不收敛边界，会很快再次变得难以演进。

**Independent Test**: 通过“模块归属与依赖方向”文档 + 静态检查/代码审查即可独立验收（不依赖外部环境）。

**Acceptance Scenarios**:

1. **Given** 任意一项既有能力（队列、WS daemon、只读搜索、写入入队等），**When** 维护者按模块索引/目录约定查找其实现，**Then** 能在单一、明确的模块边界内定位到入口与主要实现，不需要跨越多个不相关目录“追线索”。

---

### User Story 3 - 面向未来的可拆分路线 (Priority: P3)

作为未来的维护者（当业务做大做强后），我希望这次重组能为后续“抽出真正硬的子包”打下基础：具备明确的可抽取模块边界、依赖方向、以及一份可操作的拆分路线图与触发条件。

**Why this priority**: 现在不需要多包，但需要为未来留出低成本演进路径，避免再次陷入“抽出来但边界模糊”的状态。

**Independent Test**: 通过新增/更新架构说明文档即可独立验收（不依赖实现细节），并与代码结构互相对齐。

**Acceptance Scenarios**:

1. **Given** 仓库文档与代码结构，**When** 阅读“模块边界 data-model + 拆分路线图”文档，**Then** 能清晰回答：未来应抽哪些包、每个包的职责、禁止依赖、拆分触发条件、以及拆分步骤的粗粒度顺序。

---

### Edge Cases

- `--json` 模式下任意异常路径仍必须保持 stdout 纯净（单行 JSON）且 stderr 为空；重组不得引入额外日志/打印污染。
- WS daemon 与 supervisor 相关的后台进程/日志/状态文件行为保持一致（路径默认值、env 覆盖、状态字段语义、active worker 选举与 stale 判定）。
- 队列数据库的 schema 与入队/派发/ack 语义保持一致（包含幂等键、租约回收、txn 内串行 gating 等）。
- 只读 DB 工具对 `remnote.db` 的打开策略保持只读与可诊断（例如锁/缺表/FTS 不可用时的错误可解释性保持一致）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 保持 `agent-remnote` 的对外行为与契约不变（命令/参数语义、`--json` envelope、exit code 语义、WS 协议语义、队列 schema 语义）。
- **FR-002**: 系统 MUST 将现有 `packages/core` 的能力完整合并到 `packages/agent-remnote` 的代码组织内，并移除对“软边界直引 core 源码”的依赖方式，同时不改变运行时效果。
- **FR-003**: 系统 MUST 继续遵守安全红线：禁止直接写入 RemNote 官方数据库；所有写入仍必须走“队列 → WS bridge → RemNote 插件执行器”链路。
- **FR-004**: 系统 MUST 建立并落地一份清晰的模块边界 data-model：把现有能力一一归属到模块，定义允许/禁止的依赖方向，并让跨模块调用只通过各模块的最小入口进行。
- **FR-005**: 系统 MUST 追加/更新一份“面向未来的拆分路线图”文档：明确未来应该抽出的硬子包候选、抽包触发条件、迁移顺序与回滚/验证策略，并与本次重组后的模块边界保持一致。
- **FR-006**: 系统 MUST 保证仓库的常用开发工作流保持可用（构建、类型检查、测试、格式化检查），且不会要求用户改变日常命令用法。

### Non-Functional Requirements (Performance & Diagnosability)

- **NFR-001**: 系统 MUST 以自动化回归作为质量门，确保重组不会引入行为回退（至少覆盖 CLI 契约测试、关键链路 smoke checks）。
- **NFR-002**: 系统 MUST 不引入可观测的性能退化（CLI 启动、队列入队/查询、只读搜索、WS daemon 派发与心跳等关键路径在相同输入下不应显著变慢）。
- **NFR-003**: 系统 MUST 维持可诊断性与稳定标识：错误码/诊断字段保持稳定；关键实体（txn/op/requestId/connId 等）仍可用于跨日志与状态文件关联。
- **NFR-004**: 系统 MUST 避免“配置/路径解析/默认值”在多处重复实现，确保单一权威来源，减少未来漂移风险。
- **NFR-005**: 系统 MUST 为未来抽包降低耦合：核心能力模块不应依赖 CLI 命令解析细节；CLI 仅作为编排与呈现层。

### Assumptions & Dependencies

- 本次重组不引入新功能、不改变协议/Schema 语义；如发现既有实现与 SSoT 不一致，以“修实现或同步修文档”为原则完成对齐。
- `packages/plugin` 仍为写入执行器，默认不在本次重组范围内做破坏性变更（仅允许为保持兼容而进行最小改动）。
- 现有自动化测试与 SSoT 文档作为“功能不变”的主要证据来源。

### Key Entities *(include if feature involves data)*

- **Queue Transaction (txn)**: 表达一次写入批次的聚合单元（状态、优先级、幂等键、meta、时间戳等）。
- **Queue Operation (op)**: 可调度的最小写入单元（类型、payload、幂等键、状态、租约、重试与最终结果）。
- **WS Client / Active Worker**: 插件/控制通道连接的元数据与 active worker 选举状态（能力声明、活跃度、stale 判定）。
- **Bridge State Snapshot**: 跨进程可读取的状态快照（active worker、clients、kick/dispatch/ack 进度等）。
- **Module Boundary Model (data-model)**: 本次重组后对“能力→模块→依赖方向→未来抽包候选”的映射与约束集合。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 所有现有自动化契约测试在不降低覆盖意图的前提下保持通过（作为“功能不变”的硬证据）。
- **SC-002**: `--json` 模式在成功与失败场景下都满足：stdout 仅一行 JSON；stderr 为空；exit code 语义不变。
- **SC-003**: 队列/WS bridge/只读 DB 工具的关键行为保持不变（队列 schema 与派发/ack、active worker 选举、state file 持久化、只读 DB 打开策略等）。
- **SC-004**: 文档中存在一份明确的“模块边界 data-model + 面向未来拆分路线图”，并且与代码结构一致，可用于指导后续抽包与演进。
