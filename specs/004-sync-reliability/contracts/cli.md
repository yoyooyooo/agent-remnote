# Contracts 004：CLI（默认 notify + ensure-daemon + 进度查询）

**Feature**: `specs/004-sync-reliability/spec.md`  
**Date**: 2026-01-24

## 1) 写入类命令的默认行为（P1）

### 默认值

- `notify` 默认 `true`
- `ensure-daemon` 默认 `true`

并提供显式关闭：

- `--no-notify`
- `--no-ensure-daemon`

### 覆盖范围（建议）

默认开启 notify/ensure 的命令（写入类）：

- `agent-remnote apply`
- `agent-remnote write *`
- `agent-remnote write daily`
- `agent-remnote write wechat outline`
- 其它任何会调用 `enqueueOps` 入队的“高层写入”命令

默认不改变（保持显式 opt-in）的命令（底层/批量工具）：

- `agent-remnote queue enqueue`（保留为底层原语；需要时可显式 `--notify`）

## 2) `sent=0` 的语义（P1）

- `sent=0` 不应导致命令失败（退出码仍为 0）。
- CLI 必须输出英文提示（在非 JSON 输出中可见），并给出建议动作（例如：切到目标窗口触发 selection 更新/检查插件连接/`agent-remnote daemon status`）。

## 3) 进度查询（P1）

### 方案 A：新增命令（推荐）

- `agent-remnote queue progress --txn <txn_id>`
  - 输出：TxnProgress（见 `specs/004-sync-reliability/data-model.md`）

### 方案 B：增强现有命令

- `agent-remnote queue inspect --txn <txn_id>` 增加摘要字段与 score，并输出 `nextActions[]`。

## 4) Supervisor 模式一致性（P1）

- `ensure-daemon` 必须确保 supervisor 模式 daemon（避免 legacy child 模式与 supervisor 并存）。
