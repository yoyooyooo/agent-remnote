# 02 · 项目与编码规范

## 结论（TL;DR）

- 统一 TypeScript ESM（`"type":"module"`），导入路径与产物保持一致（TS 输出侧多为 `.js` 后缀）。
- 统一质量门禁为一次性命令，可在本地与 CI 复现。
- 文档与代码双向对齐：规则只写一份，变更必须同步更新。

## 质量门禁（Definition of Done）

- 推荐一次性兜底：`npm run check`
- 可拆分执行：`npm run typecheck` / `npm run lint` / `npm run format:check` / `npm test`

## 文档纪律（单一事实源）

- `docs/ssot/**`：裁决来源（不变量/契约/边界/门禁）。
- `docs/proposals/**`：草案与方案展开（未定型；成熟后可提升进 SSoT）。
- `specs/**`：推进计划与任务拆分（不作为裁决来源）。
- `handoff.md`：迁移交接记录（不作为裁决来源）。

## 工程约定（仓库级）

- 格式化：`oxfmt`（配置：`.oxfmtrc.json`）
- 静态检查：`oxlint`（配置：`.oxlintrc.json`，并在 CI/门禁中 `--deny-warnings`）
- 任务编排：`turbo`（见 `turbo.json`）

## 依赖方向（必须）

- `packages/agent-remnote` 内部依赖方向必须单向：`src/commands/**` + `src/services/**` → `src/internal/**`（internal 不得反向依赖 commands/services）。
- 运行时代码不得依赖 `scripts/**` / `docs/**` / `specs/**`（避免隐式约定与不可复现依赖）。
- `packages/plugin` 不得依赖 `packages/agent-remnote` 的运行时代码（通过 WS 协议解耦；共享契约以文档/协议为准）。
