# Implementation Plan: 019-local-host-api-and-stack

Date: 2026-03-08  
Spec: `specs/019-local-host-api-and-stack/spec.md`

本 spec 采用 **单次完整交付**，不做“先临时 shell CLI、后重构共享 core”的阶段化路线。实现必须直接落到最终边界：**共享 use cases + 双 front doors（CLI / HTTP）+ 独立 lifecycle（daemon / api / stack）**。

## Workstream A：共享能力层

目标：把 `health/status/ui-context/selection/search/write/queue wait` 抽成共享 use cases，CLI 与 API 共用。

交付：

- `api` 不通过 shell 调 CLI
- 错误模型 / nextActions / envelope 来源统一
- Host API 与 CLI 对同一 use case 返回同源结构

## Workstream B：Host API Runtime

目标：新增本机自用 HTTP runtime 与命令组 `api`。

交付：

- `api serve`（前台）
- `api start/stop/status/logs/restart/ensure`（后台生命周期）
- `api.pid` / `api.log` / `api.state.json`
- 默认 `0.0.0.0:3000`

## Workstream C：Stack 命令面

目标：为“自己本机使用”提供最低心智成本的一键入口。

交付：

- `stack ensure`
- `stack stop`
- `stack status`
- 与既有 `daemon` 命令共存，不吞并 daemon 排障入口

## Workstream D：契约、文档、测试

目标：把 CLI / HTTP / SSoT / README / tests 一次对齐，避免实现后文档漂移。

交付：

- CLI contract tests
- HTTP contract tests
- README / README.zh-CN / runbook / SSoT 更新
- quickstart / acceptance 验收路径可直接执行

