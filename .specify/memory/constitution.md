# agent-remnote Constitution（硬约束）

> 本文件是 Spec Kit 工作流的“硬约束”清单：每个 feature 的 `plan.md` 必须在 Constitution Check 中逐条映射并给出结论；若必须违反，需在 `plan.md` 的 Complexity Tracking 中显式说明理由与被拒绝的更简单替代方案。

## Non-negotiables

1) **禁止直接修改 RemNote 官方数据库**：不得写入/篡改 `remnote.db`（否则可能破坏索引/同步/升级流程）。所有写入必须走「操作队列 SQLite → WebSocket bridge → RemNote 插件（官方 SDK）执行」链路。
2) **Forward-only evolution**：本仓库拒绝向后兼容；允许 breaking change，但必须同步更新裁决文档与迁移说明，不做长期兼容层。
3) **SSoT 优先（但允许延后同步）**：协议/Schema/工具语义的裁决版在 `docs/ssot/agent-remnote/**`。实现与 SSoT 不一致时，允许在 feature 开发期以 `specs/**` + tests 作为临时基线推进，但在 feature 收尾必须同步更新 SSoT，禁止长期漂移。目录/模块边界与 workspace 成员（`package.json#workspaces`）同样视为裁决的一部分，变更必须同步更新 `docs/ssot/01-directory-structure.md`。
4) **预算与超时兜底**：任何可能阻塞的 IO/DB/WS 操作必须有明确预算与超时。`better-sqlite3` 同步查询不承诺“硬中断”；需要硬超时必须用 worker/子进程隔离。
5) **唯一消费与可诊断身份**：默认只允许一个 active worker 消费队列，避免多窗口/多端交叉执行；诊断必须能定位到具体连接实例（而非用户可共享配置）。
6) **跨平台路径规范**：所有本地文件路径必须使用 `node:os` 的 `homedir()` 与 `node:path` 的 `join/normalize` 生成；对用户输入路径必须支持 `~` 展开并 `normalize`。脚本/包脚本在传路径参数时优先使用 `~` 或交由 CLI 解析，避免写死 `$HOME/...` 这类 shell 依赖。
7) **语言（用户输出 + 代码注释）**：CLI 输出、错误信息、日志与任何用户可见的提示统一英文；代码注释默认且必须使用英文（除非必须保留原文引用/示例）。中文仅允许用于解析/匹配用户输入或内部文档（spec/proposals/ssot）。
8) **可验证性**：每次改动都要能本地验证；改 WS/队列→跑一次探活/模拟；改 CLI→跑对应 tests（或增加最小契约测试）。
9) **非破坏性默认**：除非用户明确要求，否则不执行会丢数据或难回滚的操作（清空数据库、`rm -rf`、危险 git 重置/清理等）。
10) **跨进程状态文件语义单一**：不同语义的 state 必须拆分文件与命名（例如 supervisor state vs bridge snapshot），并明确各自的默认路径、env 覆盖与禁用开关；禁止“一个 state file 承载多种互不相容的含义”。
11) **架构边界必须可自动门禁**：模块边界（例如禁止 deep import、internal 禁止反向依赖 commands/services/Effect CLI）必须有可自动执行的最小门禁（contract test 或等价检查），并纳入默认质量门禁。
12) **Write-first（最短链路）**：面向 Agent 的写入流程默认直接调用写入命令；静态校验与最小诊断内化在写入命令里，失败必须返回可行动提示与下一步命令（而不是要求调用方先 inspect 作为前置流程）。
13) **Agent Skill 同步**：当 CLI 写入链路/命令面发生变更（新增/删除/重命名/默认值变化/诊断字段变化）时，必须在 feature 收尾同步更新 `$remnote`（`~/.codex/skills/remnote/SKILL.md`）的最短 recipes 与命令选择标准，避免 Agent 选到低效路径。

## Default Quality Gates

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm test`
