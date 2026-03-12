# 特性规格：Host API 通用远程化与 Workspace 自动绑定

**特性分支**: `[021-host-api-remote-surface-and-workspace-binding]`  
**创建日期**: 2026-03-12  
**状态**: Draft  
**输入**: 用户描述：“希望容器内调用与远程调用统一成同一类 Host API client 语义；把当前实现继续推向更彻底、更通用的远程 API。另一个重点是本地多个 `remnote.db` 并存时，系统应尽量零配置、稳定地自动选定正确 KB，对用户隐藏底层路径细节。”

全局概念与术语裁决见：`specs/CONCEPTS.md`（Control/Data/UX planes、WS 协议、queue 一致性、CLI envelope 等）。

## 背景与动机

`019-local-host-api-and-stack` 已经完成了宿主机 authoritative runtime + Host API + stack 命令面的第一阶段落地，容器内 agent 可以通过宿主机 API 读写 RemNote。

但当前实现仍带有较强的“宿主机 + 本地容器”假设，距离“通用远程 API surface”还有几处关键边界未收口：

- Host API 的路由前缀在实现中仍写死为 `/v1`，`apiBasePath` 尚未真正贯通。
- API 状态输出仍偏向本机 / container 提示，缺少“任意远程调用方都一致”的契约表达。
- remote mode 覆盖面仍不完整，一部分命令在配置了 `apiBaseUrl` 后会 fail-fast。
- DB 路径自动发现仍以目录扫描为兜底，机器上存在多个 `remnote-<workspaceId>/remnote.db` 时，长期稳定性依赖启发式判断。
- 插件侧已经能稳定上报 `uiContext.kbId`，但系统尚未把 `workspaceId -> dbPath` 绑定升级为长期持久化事实源。

本 spec 的目标是把 019 继续推进到下一阶段：

- 对调用方语义统一为“只认 `apiBaseUrl` 的远程客户端”
- 对宿主机内部语义统一为“workspace binding 驱动的确定性 DB 解析”
- 对能力边界统一为“capability-aware 的远程 API 契约”

## Scope

### In Scope

- 将 Host API 继续演进为通用远程 API surface，容器、本机其他进程、跨机器调用方共享同一套 client 语义。
- 落地 `workspace binding` 持久化模型，作为 DB 解析的第一事实源。
- 为 DB 读取相关能力建立确定性的 workspace / db 解析顺序。
- 将 `apiBasePath` 从配置层打通到服务端路由、客户端请求、状态文件与文档。
- 为 Host API 增补 capability 状态表达，使远程调用方能区分：
  - `db_read_ready`
  - `plugin_rpc_ready`
  - `write_ready`
  - `ui_session_ready`
- 明确并文档化“哪些命令 / 端点可远程调用、哪些仍要求宿主机本地能力”。
- 将“当前 KB / 绑定来源 / 候选 workspace / unresolved 诊断”纳入 Host API 状态面。

### Out of Scope

- Cloudflare Tunnel、Access、CORS、RBAC、多租户鉴权。
- 改变 `queue -> WS -> plugin SDK` 写入红线。
- 将插件执行器从 RemNote Desktop 中剥离成无 UI 的后台执行器。
- 多用户并发会话隔离。当前仍以单宿主机、单用户、有限数量活跃 RemNote 客户端为前提。
- 对 019 的历史行为提供长期兼容层。forward-only evolution 继续有效。

## 架构裁决

### 裁决 1：远程调用方只认 `apiBaseUrl`

- 远程 client 的标准入口是 `apiBaseUrl`。
- 调用方来自本机、容器、局域网、经隧道访问的外部环境，均不影响 client 语义。
- `host.docker.internal`、`127.0.0.1`、公网域名等地址形态只属于部署层，不属于能力层契约。
- remote mode 的唯一开关是 `apiBaseUrl` 是否存在且有效。
- `apiHost`、`apiPort`、`apiBasePath` 只影响服务监听、状态输出与 URL 解析，不参与业务命令的 mode 判定。

### 裁决 2：workspace binding 是 DB 解析的长期事实源

- 系统必须持久化 `workspaceId -> dbPath` 绑定关系。
- 系统必须持久化“当前默认 workspace”指针。
- 只要绑定仍可验证，后续 DB read 必须优先使用该绑定，不再回退到目录最近修改时间这种启发式选择。

### 裁决 3：live `uiContext.kbId` 是首次自动绑定的最强信号

- 一旦插件上报了 `uiContext.kbId`，系统应立即尝试解析 `~/remnote/remnote-<kbId>/remnote.db`。
- 若文件存在，该绑定应被写入宿主机本地状态，并作为后续默认 workspace。
- deep link 中的 `workspaceId` 也属于强信号，应优先命中既有 binding 或触发一次确定性解析。

### 裁决 4：目录扫描只负责“枚举候选”，不负责“持久化猜测”

- 当系统无法从显式 workspace、既有 binding、live `kbId` 得到确定性结果时，可扫描 `~/remnote/` 生成候选集。
- 若只有一个 primary 候选库，系统可自动采用并持久化。
- 若存在多个 primary 候选库，系统必须返回 `WORKSPACE_UNRESOLVED` 诊断，禁止把“最新 DB”写入长期绑定。

### 裁决 5：Host API 必须显式表达 capability，而不是只报健康

- `health` / `status` 必须能回答“服务活着”之外的问题：
  - 当前 workspace 是否已解析
  - DB read 是否 ready
  - plugin RPC 是否 ready
  - write path 是否 ready
  - UI session 是否 ready
- 远程调用方应能仅凭状态接口判断下一步是否能调用某个端点。

### 裁决 6：binding / resolver 只在需要的端点上生效

- 不是所有 Host API 端点都应先执行 workspace binding / DB resolver。
- 端点至少分为三类：
  - 不依赖 binding 的端点：只看服务、队列、daemon、WS 等运行时状态
  - 只依赖 binding snapshot 的端点：需要展示当前 workspace / capability 状态，但不必真的打开 DB
  - 依赖 DB resolver 的端点：必须得到确定性的 `workspaceId + dbPath`
- 实现时不得把“先跑一遍 resolver”做成所有请求的统一前置中间件。

### 裁决 7：UI session 类端点保留全局单机会话语义，但要写清楚

- `ui-context`、`selection`、`plugin current` 等能力继续依赖活跃 RemNote client / active worker。
- 这些端点当前仍服务于“当前宿主机活跃会话”，并非面向多租户会话路由。
- 远程契约必须清楚标注这种语义，避免调用方将其误解为纯后端、无状态读取能力。

## 用户场景与测试

### 用户故事 1：任意远程调用方共享同一套 Host API client 语义 (Priority: P1)

作为调用方，我希望无论自己运行在容器、本机其他进程、还是远程机器，只要拿到一个 `apiBaseUrl`，就能调用同一套 Host API，而不需要知道宿主机是否使用了容器桥接地址或本地地址。

**Why this priority**：这是“通用远程 API”最核心的契约收口点。只要调用方仍需区分 container 模式和 remote 模式，API surface 就还没有彻底收干净。

**Independent Test**：使用同一份 Host API 契约文档与同一个 `apiBaseUrl`，从两种不同调用环境发起 `health/status/search/apply/queue wait` 调用，验证请求语义与响应 envelope 完全一致。

**Acceptance Scenarios**：

1. **Given** 宿主机上的 Host API 已启动，**When** 一个调用方仅配置 `apiBaseUrl`，**Then** 它可以完成远程支持的业务命令调用，而无需配置本地 DB 路径、WS 地址、或区分 container 特殊分支。
2. **Given** Host API 被挂载在非默认路径前缀下，**When** 调用方通过配置的 `apiBaseUrl` / `apiBasePath` 发起请求，**Then** 服务端与客户端必须使用同一个前缀解析规则，不得出现硬编码 `/v1` 导致的 404。

### 用户故事 2：系统零配置地稳定绑定当前 KB (Priority: P1)

作为宿主机用户，我希望第一次把目标 KB 打开后，系统能自动记住当前 workspace 与对应 `remnote.db` 的关系，之后即使插件短暂离线或重启，远程 DB read 仍能落到同一个 KB。

**Why this priority**：当前机器往往存在多个本地 KB。若没有稳定 binding，远程 DB read 结果会随着目录修改时间或运行时状态波动，难以成为可靠 API。

**Independent Test**：在一台存在多个 `remnote-<workspaceId>/remnote.db` 的机器上，先打开目标 KB 触发一次 `uiContext.kbId` 上报，再关闭或重启插件。随后调用 `search` / `outline`，验证系统仍使用首次绑定的同一个 DB。

**Acceptance Scenarios**：

1. **Given** 系统首次观察到 live `uiContext.kbId`，且对应 DB 文件存在，**When** 宿主机继续提供 Host API，**Then** 系统必须自动创建 `workspaceId -> dbPath` binding，并将该 workspace 设为当前默认 workspace。
2. **Given** 已存在有效 binding，**When** 插件暂时离线但 DB 文件仍可读，**Then** DB read 相关端点必须继续工作，并继续解析到同一个 workspace。
3. **Given** 宿主机存在多个 primary KB 且尚无 binding，**When** 没有 live `uiContext.kbId` 可用，**Then** 系统必须返回 `WORKSPACE_UNRESOLVED`，并给出候选 workspace / dbPath 列表与下一步动作；不得把“目录最新库”写入长期 binding。

### 用户故事 3：调用方能判断某类能力是否 ready (Priority: P2)

作为远程调用方，我希望在发起高成本请求前先知道当前宿主机具备哪些能力，例如 DB read 已就绪、plugin search 未就绪、write path 未就绪，从而决定重试、降级、还是等待宿主机 UI。

**Why this priority**：Host API 未来既包含纯 DB read，也包含 plugin / UI 依赖能力。若状态面没有 capability，调用方只能盲调端点，错误恢复成本高。

**Independent Test**：分别构造“仅 DB 可用”“DB + plugin RPC 可用”“write path 可用但无 active UI selection”等场景，验证 `status` 可以区分 readiness。

**Acceptance Scenarios**：

1. **Given** DB 文件可读但 plugin 未连接，**When** 调用 `status`，**Then** 响应必须能表达 `db_read_ready=true`、`plugin_rpc_ready=false`、`write_ready=false`。
2. **Given** active worker 已连接且 queue / daemon 正常，**When** 调用 `status`，**Then** 响应必须能表达 `plugin_rpc_ready=true`，并在可写时表达 `write_ready=true`。

### 用户故事 4：维护者能显式区分“DB 绑定问题”和“UI 会话问题” (Priority: P2)

作为维护者，我希望当远程调用失败时，系统能明确告诉我是 workspace 未解析、DB 不可读、plugin 不在线、还是 UI selection 不存在，从而快速定位故障边界。

**Why this priority**：当前 Host API 同时承载 DB read、plugin RPC、UI session 三类能力。若错误与状态不能映射到清晰边界，远程调用将难以排障。

**Independent Test**：人为制造 workspace unresolved / db missing / plugin unavailable / no active selection 四种场景，验证错误码与状态字段可稳定区分。

## Requirements

### Functional Requirements

- **FR-001**：系统 MUST 将 Host API 继续定义为“宿主机 authoritative runtime 的通用远程 surface”，远程 caller 的位置不得影响请求语义；业务命令是否进入 remote mode 仅由 `apiBaseUrl` 判定。
- **FR-002**：系统 MUST 将 `apiBasePath` 从配置层贯通到：
  - API runtime 路由匹配
  - `HostApiClient` 请求拼接
  - `api.state.json`
  - `api status` / `stack status`
  - README / runbook / SSoT
- **FR-003**：系统 MUST 为宿主机维护持久化 workspace binding 状态，至少包含：
  - `workspaceId`
  - `kbName`
  - `dbPath`
  - `source`
  - `firstSeenAt`
  - `lastVerifiedAt`
  - `lastUiContextAt?`
- **FR-004**：系统 MUST 维护 `currentWorkspaceId` 这一当前默认 workspace 指针，并在状态接口中暴露其值与来源。
- **FR-005**：系统 MUST 按如下优先级解析 DB read 所使用的 workspace / dbPath：
  1. 显式请求中的 `workspaceId` / deep link workspace
  2. 已存在且可验证的 binding
  3. live `uiContext.kbId`
  4. 唯一 primary 候选库自动采用
  5. unresolved fail-fast
- **FR-006**：当首次观察到 live `uiContext.kbId` 且可解析到 `remnote-<kbId>/remnote.db` 时，系统 MUST 自动创建或刷新 binding，并将其设为 `currentWorkspaceId`。
- **FR-007**：当目录扫描得到多个 primary `remnote-<workspaceId>/remnote.db` 候选，且没有更强信号可用时，系统 MUST 返回 `WORKSPACE_UNRESOLVED` 诊断；不得将“最近修改时间最新”的候选写入长期 binding。
- **FR-008**：目录扫描逻辑 MUST 将自身角色限定为“候选集枚举与单候选自动采用”；它不得再承担多候选场景下的长期默认裁决。
- **FR-009**：Host API `status` MUST 暴露 capability 状态，至少包括：
  - `db_read_ready`
  - `plugin_rpc_ready`
  - `write_ready`
  - `ui_session_ready`
- **FR-010**：Host API `status` MUST 暴露 workspace 解析状态，至少包括：
  - `currentWorkspaceId`
  - `currentDbPath`
  - `bindingSource`
  - `resolved`
  - `candidateWorkspaces[]`
- **FR-011**：当某个端点依赖的 capability 未满足时，系统 MUST 返回稳定错误码与 next actions，错误语义必须能区分：
  - workspace unresolved
  - db unavailable
  - plugin unavailable
  - write path unavailable
  - ui session unavailable
- **FR-012**：remote-capable 业务命令矩阵 MUST 被显式文档化。尚未支持远程的命令必须返回稳定错误，并说明所缺能力边界。
- **FR-013**：DB read 相关端点 SHOULD 支持显式传入 `workspaceId`，以便调用方在已知目标 KB 时绕过默认 workspace 选择。
- **FR-014**：依赖 UI 会话的端点 MUST 明确标注其“当前活跃宿主机会话”语义，不得让调用方误解为纯无状态后端查询。
- **FR-015**：`api.state.json` 与状态端点 MUST 使用通用远程 API 语义表达监听信息和推荐访问信息；`containerBaseUrl` 可保留为诊断辅助字段，但不得再充当唯一远程访问示例。
- **FR-016**：相关文档 MUST 同步更新，包括：
  - `specs/019-local-host-api-and-stack/*` 中与演进后行为冲突的部分
  - `docs/ssot/agent-remnote/http-api-contract.md`
  - `README.md`
  - `README.zh-CN.md`
  - `docs/runbook/local-host-api.md`
- **FR-017**：系统 MUST 明确维护端点分层矩阵，至少区分：
  - `no_binding`
  - `binding_snapshot_only`
  - `db_resolver_required`
  并据此组织实现与测试，避免所有端点统一前置 DB 解析。

### Non-Functional Requirements

- **NFR-001**：零配置优先。单用户宿主机在“打开一次目标 KB”之后，应能稳定完成后续远程 DB read，而无需手动配置 `remnoteDb` 路径。
- **NFR-002**：选择必须可解释。每一次 workspace / dbPath 解析都必须能回溯其来源（explicit / binding / live_ui_context / single_candidate_auto / unresolved）。
- **NFR-003**：诊断必须 fail-fast。多候选且无确定性信号时，系统应立即返回 unresolved 诊断，不应通过隐式猜测制造长期漂移。
- **NFR-004**：演进不得破坏 019 已落地的“宿主机 authoritative + Host API + stack 命令面”主路径。
- **NFR-005**：所有用户可见错误信息、日志与 CLI / API 文本继续保持英文；spec 说明允许中文。

### Assumptions

- 宿主机可以同时存在多个本地 KB，每个 KB 通常对应 `~/remnote/remnote-<workspaceId>/remnote.db`。
- 插件已具备上报 `kbId` / `kbName` 的能力，可作为 workspace binding 的强信号。
- 当前阶段仍以单宿主机单用户场景为主，不处理多租户或跨用户授权模型。

### Key Entities

- **Workspace Binding**：宿主机本地持久化记录，描述一个 `workspaceId` 与其 `dbPath` 的长期对应关系。
- **Current Workspace Pointer**：当前默认使用的 workspace 指针，供未显式指定 workspace 的 DB read 请求使用。
- **Workspace Candidate**：目录扫描得到的本地 KB 候选项，仅用于枚举、单候选自动采用和 unresolved 诊断。
- **Capability State**：Host API 对外暴露的 readiness 状态集合，帮助远程调用方判断哪些端点当前可调用。

## Success Criteria

### Measurable Outcomes

- **SC-001**：在一台存在多个本地 `remnote.db` 的机器上，用户只需打开目标 KB 一次，系统即可自动建立 workspace binding，后续远程 `search` / `outline` 请求持续命中同一 DB，即使插件暂时离线也不漂移。
- **SC-002**：`apiBasePath` 可被配置为非 `/v1` 的任意有效前缀，且服务端路由、客户端请求、状态输出、README 示例保持一致。
- **SC-003**：当宿主机存在多个 primary KB 且尚无 live `kbId` / 既有 binding 时，系统返回 `WORKSPACE_UNRESOLVED`，并附带候选 workspace 列表与 next actions；系统不再把“最新 DB”写入长期默认值。
- **SC-004**：远程调用方可仅通过 `status` 判断当前是否具备 `db_read_ready`、`plugin_rpc_ready`、`write_ready`、`ui_session_ready` 四类能力。
- **SC-005**：同一份业务命令在 remote mode 下只依赖 `apiBaseUrl`，无论调用方位于容器、本机其他进程还是远程机器，契约和行为均一致。
