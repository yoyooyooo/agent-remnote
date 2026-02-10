# Quickstart 005：安全搜索（插件候选集 + DB 精筛 + 超时兜底）

**Feature**: `specs/005-search-safety/spec.md`  
**Date**: 2026-01-24

> 本 Quickstart 用于实现完成后的最小验证闭环（P1）：插件候选集 `<=3s`，DB 精筛 `<=30s`（硬超时）。

## 0) 前置条件

- WS bridge 已启动（示例：仓库根目录 `npm run dev:ws`）。
- RemNote 客户端已安装并打开本仓库插件，且已连接 WS（control channel）。
- Spec 003 已落地（vNext：`connId + active worker`，移除 `consumerId`），read-rpc 才能稳定路由。

## 1) 插件候选集搜索（探索期，P1）

1. 在 RemNote 中切到你希望作为“活跃会话”的窗口（确保会产生 selection/uiContext 更新）。
2. 运行候选集命令（见 `specs/005-search-safety/contracts/cli.md`）：
   - `agent-remnote read search-plugin --query "keyword"`
3. 验收：
   - 返回时间 `<= 3000ms`（或响应 `TIMEOUT`，并带 `nextActions[]`）。
   - `results.length <= 20`（或 limit clamp 生效并标注）。
   - 每条结果含 `title/snippet/truncated`。

## 2) 失败/超时兜底（P1）

- 插件不在线/无 active worker：应返回 `NO_ACTIVE_WORKER`，并给出建议型 `nextActions[]`。
- 若启用 `--fallback-db`：应自动回退到 DB 搜索（并在输出中标注回退原因）。

## 3) 后端 DB 精筛/展开（确定性处理，P1）

1. 从候选集中选择 3–5 个 `remId`（或直接使用现有 `agent-remnote read search` 命中结果）。
2. 执行精筛/展开（实现后由对应命令承载；可先用现有 `agent-remnote read search` 做基线）。
3. 验收：
   - 单次查询超过 30s 必须返回超时错误（硬超时），并带 `nextActions[]` 指导收敛条件（timeRange/limit/parentId/换策略）。
