# 契约：Host API 查询面

日期：2026-03-22

## 目的

定义 031 需要补齐的 Host API selector / metadata surface。

## 必须覆盖

- host-authoritative powerup metadata capability
- query V2 selector execution on existing `POST /v1/read/query`
- selector parity under custom base path
- scenario execution prerequisites where remote host facts are required
- thin scenario execution surface on `POST /v1/scenario/run` if `scenario run` is admitted in 031

## Query V2 Canonical Body

- 031 把现有 `POST /v1/read/query` 升级为 Query V2 的 canonical remote body。
- canonical request body 形态固定为：
  - `query`
    - `QuerySelectorV2`
  - `limit?`
  - `offset?`
  - `snippetLength?`
- canonical body 不再把 `queryObj` 作为对外 contract 字段。
- migration adapter 可以在 HTTP 边界暂时接受下列 legacy 输入：
  - `{ "queryObj": { ... } }`
  - `{ "query": { "root": ... } }`
  - `{ "root": ... }`
- 这些 legacy 形态只允许停留在 adapter boundary；进入 host use case、selector parity test、shared contract compare 前，必须规范化成 canonical body。

## 公开面约束

- `ScenarioPackage` 是客户端提交给宿主的最高层 canonical execution artifact
- Host API 不接受客户端直接提交 `ScenarioExecutionPlanV1`
- Host API 不接受客户端直接提交 `SelectionSet`
- Host API 不公开 `scenario compile`、`scenario materialize-selection`、`scenario execute-node` 这类内部阶段端点
- powerup metadata 首先作为宿主内部 authoritative capability 服务 query/scenario/runtime；是否公开成独立 business routes 留给 wave3
- `scenario schema *` 属于纯 tooling，可继续本地消费 shared contract，不要求 031 强制走远端

## Powerup Metadata Phase Split

- 031 冻结两层能力：
  - host-internal metadata capability
    - 供 Query V2、ScenarioExecutionPlanV1、selector execution、powerup predicate normalization 复用
  - public business route
    - 是否把 `powerup list|resolve|schema` 升级到 remote-capable public routes，留给后续 wave 与 authoritative inventory 决定
- 在 031 范围内，`powerup list|resolve|schema` 继续遵守当前 deferred remote failure contract，直到：
  - authoritative inventory 收录对应 command id
  - Host API contract 新增公开 endpoint
  - CLI / HostApiClient / tests 同步完成
- 因此，031 对 powerup metadata 的承诺是“统一 authoritative path”，当前不承诺“立即把现有 powerup business commands 变成 remote-capable public surface”。

## 031 冻结边界

- Host API 负责 remote execution surface，不负责 scenario authoring surface
- `scenario schema validate|normalize|explain|scaffold|generate` 优先走共享子包与 CLI tooling，不新增对等 Host API tooling endpoints
- 若后续把 `scenario run` 升级为正式 public surface，remote path 只能消费 canonical package / package ref + vars，不能接受第二套 host-only DSL
- 当 `apiBaseUrl` 已配置时，`scenario schema *` 仍在调用方本地执行，并继续消费 shared contract / local CLI tooling：
  - 不因为 remote mode 而 fail fast
  - 不因为 remote mode 而转发到 Host API
  - 不读取 host-bound runtime facts
- `apiBaseUrl` 只影响需要宿主事实或执行面的能力，例如 Query V2 selector execution、future admitted `scenario run`、write/apply parity。

## 031 与 030 派生结论的迁移规则

- 当 031 显式记录与 030 派生 taxonomy 或 contract 结论的冲突时，以 031 作为当前归一化波次的 authority
- 冲突点与迁移影响必须先记录在 031，再同步回全局 SSoT

## 可扩面方向

- 升级现有 `POST /v1/read/query` 到 Query V2 canonical payload
- 先补齐 powerup metadata host-internal authoritative capability
- 仅在 inventory / CLI / tests 同步收口后，再考虑公开 powerup metadata business routes
- 仅在 `scenario run` 命令面冻结后，再为 host-side execution 预留对应 endpoint

## 明确留白

- 不在 031 中为 schema tooling 暴露独立 remote authoring API
- 不在 031 中把 runtime scheduling internals 暴露成 public Host API contract
- 不在 031 中把 shared compile/normalize 逻辑复制进 Host API 形成第二真相源
- 不在 031 中通过 `apiBaseUrl` 改写 `scenario schema *` 的本地 authoring 语义

## 原则

- Host API is the only remote execution surface
- remote mode remains transport switch only
