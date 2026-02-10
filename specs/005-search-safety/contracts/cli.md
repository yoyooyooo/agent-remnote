# Contracts 005：CLI（插件候选集搜索）

**Feature**: `specs/005-search-safety/spec.md`  
**Date**: 2026-01-24

> 目标：给 Agent 一个显式入口调用“插件候选集搜索”（阻塞式 read-rpc），并在失败时提供确定的兜底与建议动作。

## 新增命令（建议）

### `agent-remnote read search-plugin`

用途：通过 WS read-rpc 调用插件候选集搜索（默认 3s/Top‑20），返回 `title/snippet` 供 Agent 选择候选。

建议 flags：

- `--query <text>`（必填）
- `--context-rem-id <id>`（可选；收敛范围）
- `--limit <n>`（默认 20；最大 100；clamp）
- `--timeout-ms <ms>`（默认 3000；最大 5000；clamp）
- `--fallback-db`（可选；当插件不可用/超时时自动回退到 DB 搜索）
  - 若启用回退：复用 `read search` 的过滤 flags（如 `--time/--parent/--pages-only/--exclude-pages/--limit/--offset`）

输出（`--json`）建议 shape：

```json
{
  "ok": true,
  "data": {
    "mode": "plugin_candidates",
    "budget": { "timeoutMs": 3000, "limitRequested": 20, "limitEffective": 20, "durationMs": 120 },
    "results": [{ "remId": "id", "title": "t", "snippet": "s", "truncated": false }]
  }
}
```

失败（插件不可用/超时）建议：

- `ok=false` + `code`（例如 `NO_ACTIVE_WORKER` / `TIMEOUT` / `PLUGIN_ERROR`）
- 带 `nextActions[]`（建议型，英文句子）
- 若 `--fallback-db`：返回 `mode="db_fallback"`，并在 `data.fallback` 标注触发原因

## 兼容性（forward-only）

- 允许新增该命令而不改变现有 `agent-remnote read search`（DB 搜索）语义。
- 若未来需要把 `read search` 默认改为“两阶段策略”，应作为 breaking change 明确写入迁移说明（不做兼容层）。
