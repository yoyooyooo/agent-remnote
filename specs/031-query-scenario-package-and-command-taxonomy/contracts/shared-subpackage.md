# 契约：Shared Subpackage Boundary

日期：2026-03-22

## 目的

定义 031 新增共享子包的职责边界，使前端插件、后端运行时、CLI tooling 与 skill 可以共用同一份纯契约与纯逻辑，同时避免宿主执行逻辑下沉。

## 031 冻结的边界

共享子包只承载：

- Query AST V2 schema / types / normalization
- `ScenarioPackageV1` schema / types / normalization
- `StructuredReferenceNode` schema / types / validation
- `SelectionSet` schema / types
- `ScenarioExecutionPlanV1` schema / types
- `scenario schema` tooling request / response envelope
- 纯静态校验
  - DAG acyclic check
  - structured reference shape validation
  - capability declaration validation
- 纯规范化
  - field alias normalization
  - default filling
  - canonical ordering
- host-independent planning canonicalization
  - node slot registry build
  - `depends_on` normalization
  - `phase=planned` skeleton build
- 纯 preview / explain helpers
  - execution outline skeleton
  - scheduling hint validation

## 明确禁止下沉的逻辑

以下逻辑必须留在 host-authoritative runtime：

- workspace binding 与 DB 选择
- ref resolution
- query scope 展开
- powerup metadata 解析
- selector 求值
- `SelectionSet` materialization
- 依赖宿主 metadata 的 action lowering
- compile 到 business command / `apply kind=actions`
- queue / WS / plugin 调度
- Host API transport
- `phase=resolved` host facts 构造
- `phase=compiled` compiled execution 构造
- local / remote adapter 选择与 Effect runtime wiring

## 允许依赖

- 平台无关、无副作用的 schema / validation / utility 依赖
- 纯数据结构与纯函数

## 禁止依赖

- `node:fs`、`node:path`、`node:os`
- SQLite / DB adapters
- `HostApiClient`
- `ModeParityRuntime`
- queue / ws / daemon services
- RemNote plugin SDK
- 任何依赖进程环境、网络、文件系统、当前 workspace 的逻辑
- `services/*`
- `internal/*`
- 直接复用带 runtime 注入的 business-semantics adapter

## 名称裁决

- 031 先冻结“边界”与“导出物”
- 具体 package name 可以在实现前再定
- package name 不应暗示它拥有宿主执行逻辑
