# SSoT（单一事实源）

本目录维护本仓库「当前必须为真」的裁决：不变量、契约、边界与质量门禁；并指回代码锚点与验证方式。

SSoT 只写“现在就应成立”的规则与口径；研究/草案/规划请放在 `docs/proposals/**` 或 `specs/**`，避免把未验证方案混入裁决来源。

## 裁决优先级（冲突时）

1. `docs/ssot/**`
2. 源码真实行为 + tests/CI（若与 SSoT 不一致，必须修复漂移：改代码或回写 SSoT）
3. `docs/proposals/**`
4. `specs/**`
5. `handoff.md`（交接/迁移记录）

## 最短阅读路径

1. [`00-principles.md`](00-principles.md)
2. [`01-directory-structure.md`](01-directory-structure.md)
3. [`02-project-and-coding-standards.md`](02-project-and-coding-standards.md)
4. [`03-architecture-guidance.md`](03-architecture-guidance.md)
5. `docs/ssot/agent-remnote/README.md`

## 相关权威文档（按类型）

- agent-remnote 协议与契约（SSoT）：`docs/ssot/agent-remnote/README.md`
- 排障与调试（guides）：`docs/guides/README.md`
- RemNote 概念与用法：`docs/remnote/README.md`
- RemNote 本地 DB 结构笔记（只读）：`docs/remnote/database-notes.md`
- 草案与方案展开（proposals）：`docs/proposals/README.md`
