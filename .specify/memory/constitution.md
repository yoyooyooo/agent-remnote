<!--
Sync Impact Report
- Version change: 1.1.0 -> 1.2.0
- Modified principles:
  - none
- Added sections:
  - RemNote Business Command Mode Parity
- Removed sections:
  - none
- Templates requiring updates:
  - Spec Kit template set (external global install) ✅ reviewed, no repo-local change required
  - Spec Kit reference set (external global install) ✅ reviewed, no repo-local change required
- Follow-up TODOs:
  - none
-->

# agent-remnote Constitution（硬约束）

> 本文件是 Spec Kit 工作流的“硬约束”清单：每个 feature 的 `plan.md` 必须在 Constitution Check 中逐条映射并给出结论；若必须违反，需在 `plan.md` 的 Complexity Tracking 中显式说明理由与被拒绝的更简单替代方案。

- **Version**: 1.2.0
- **Ratified**: 2026-02-10
- **Last Amended**: 2026-03-22

## Non-negotiables

1) **禁止直接修改 RemNote 官方数据库**：不得写入/篡改 `remnote.db`。所有写入必须走「操作队列 SQLite → WebSocket bridge → RemNote 插件（官方 SDK）执行」链路。

2) **Forward-only evolution**：本仓库拒绝向后兼容；允许 breaking change，但必须同步更新裁决文档与迁移说明，不做长期兼容层。

3) **SSoT 优先（但允许延后同步）**：协议、Schema、工具语义的裁决版在 `docs/ssot/agent-remnote/**`。实现与 SSoT 不一致时，允许在 feature 开发期以 `specs/**` + tests 作为临时基线推进，但在 feature 收尾必须同步更新 SSoT，禁止长期漂移。目录、模块边界与 workspace 成员同样属于裁决的一部分。

4) **预算与超时兜底**：任何可能阻塞的 IO、DB、WS 操作都必须有明确预算与超时。`better-sqlite3` 同步查询不承诺硬中断；需要硬超时必须用 worker 或子进程隔离。

5) **唯一消费与可诊断身份**：默认只允许一个 active worker 消费队列，避免多窗口、多端交叉执行；诊断必须能定位到具体连接实例，不能停留在用户级共享配置。

6) **跨平台路径规范**：所有本地文件路径必须使用 `node:os` 的 `homedir()` 与 `node:path` 的 `join/normalize` 生成；对用户输入路径必须支持 `~` 展开并 `normalize`。脚本和包脚本传路径参数时优先使用 `~` 或交由 CLI 解析，避免写死 shell 特定路径。

7) **语言（用户输出 + 代码注释）**：CLI 输出、错误信息、日志与任何用户可见的提示统一英文；代码注释默认且必须使用英文。中文仅允许用于解析、匹配用户输入或内部文档。

8) **可验证性**：每次改动都要能本地验证；改 WS、队列要跑探活或模拟；改 CLI 要跑对应 tests，或补最小契约测试。

9) **非破坏性默认**：除非用户明确要求，否则不执行会丢数据或难回滚的操作，例如清空数据库、危险删除、危险 git 重置或清理。

10) **跨进程状态文件语义单一**：不同语义的 state 必须拆分文件与命名，并明确默认路径、env 覆盖与禁用开关；禁止一个 state file 承载多种互不相容的含义。

11) **架构边界必须可自动门禁**：模块边界必须有可自动执行的最小门禁，并纳入默认质量门禁。

12) **Write-first（最短链路）**：面向 Agent 的写入流程默认直接调用写入命令；静态校验与最小诊断内化在写入命令里，失败必须返回可行动提示与下一步命令，不能把 inspect 变成默认前置步骤。

13) **CLI Agent-First（最小完备原子能力）**：CLI 对外面必须优先暴露最小完备的原子命令与通用参数，而不是封装场景化、工作流化、颗粒度更粗的命令或参数。
    - 新增 CLI surface 前，必须先证明现有原子命令、通用参数、`apply` actions、selector、surface、bucket、group、limit 等通用维度无法表达该能力。
    - 场景编排、默认 recipes、上层工作流、报告或摘要类语义，默认放在 Skill、文档示例或调用方组合层，不进入 CLI public surface。
    - 优先新增通用维度参数，禁止优先新增场景名参数；例如优先考虑 selector、surface、bucket、group、limit 一类通用参数，避免引入 `summary`、`weekly-report`、`dashboard` 这类场景词。
    - 仅为局部命令增加一个新的同义 alias，若不能显著减少全局表面积，则默认禁止；需要别名时，必须证明它降低了整体认知成本，而不是增加了 surface area。
    - `plan.md` 只要涉及 CLI、HTTP API、tool schema、Host API 或 agent-facing payload 变更，Constitution Check 都必须显式回答：这是否仍然保持了最小完备原子能力，是否把上层场景错误地下沉到了 CLI。

14) **Agent Skill 同步**：当 CLI 写入链路、读取链路、命令面、默认值、诊断字段或 machine-readable contract 发生变更时，必须在 feature 收尾同步更新 `$remnote`（repo-local `skills/remnote/SKILL.md`，必要时再同步到外部镜像）的最短 recipes 与命令选择标准。Skill 必须承担上层场景编排，避免 Agent 选到低效路径或把场景逻辑误下沉进 CLI。

15) **RemNote Business Command Mode Parity**：凡是直接读取或写入 RemNote 知识状态、Rem 图谱、表/属性记录、当前 UI/selection 业务上下文的 Agent-facing 命令，都属于 “RemNote business commands”，必须在 local mode 与 remote mode 下保持同一业务契约。
    - 配置 `apiBaseUrl` 只能切换执行传输面，不能改变命令形状、参数语义、校验规则、输出字段、错误码或 receipt 语义。
    - 任何依赖宿主事实的业务语义，包括 ref 解析、workspace binding、placement 解析、selection 解析、contiguous range 判定、title inference、capability gating、receipt enrichment，都必须收口为 host-authoritative 逻辑，并由 local/remote 两个薄适配层复用。
    - 对 RemNote business commands，禁止长期保留“本地一套业务判断 + remote 一套业务判断”的双实现；允许存在的差异仅限 transport、超时与服务可达性诊断。
    - 无法满足该原则的命令，必须在全局文档与 SSoT 中显式重新分类为 host-only operational command，不能继续算作 RemNote business command。
    - 任何新增或重构 RemNote business command 的 spec / plan / tasks，都必须显式给出 parity strategy、gap inventory 与 remote-first integration verification。

## Default Quality Gates

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm test`

## Governance

- **Amendment Process**: 宪法变更必须通过显式 spec 或治理裁决落盘到 `.specify/memory/constitution.md`，并同步更新 `Last Amended`、版本号与顶部 Sync Impact Report。
- **Versioning Policy**:
  - **MAJOR**：移除原则、重定义原则，或引入与既有治理不兼容的强制约束
  - **MINOR**：新增原则、新增治理章节，或对现有原则做实质性扩展
  - **PATCH**：澄清措辞、修正文案、补充不改变语义的说明
- **Compliance Review**: 每个 `plan.md` 的 Constitution Check 必须逐条映射本文件；若任何一条无法满足，必须在 `Complexity Tracking` 中说明理由、替代方案与不采纳原因。未映射视为不合规。
