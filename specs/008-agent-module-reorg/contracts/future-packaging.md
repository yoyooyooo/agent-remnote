# Contract: Future Packaging Roadmap（面向未来拆包路线图）

**Feature**: `008-agent-module-reorg`  
**Date**: 2026-01-24  
**Goal**: 在保持单包 CLI 的前提下，为未来“抽出硬子包”准备可执行路线图

## 1) 为什么现在不拆包

当前没有外部项目/服务复用 `queue/ws/remdb-tools`，且代码仍处在高频演进阶段。过早形成多个 package 会导致：

- 边界不清 → package 只是“目录搬家”，反而更难重构；
- 版本/发布/依赖管理成本上升；
- 需要维护更多 build/test gate，减慢迭代速度。

因此本次策略是：**先在单包内把边界做硬（internal modules），等出现真实驱动再抽包**。

## 2) 抽包触发条件（任一满足即可启动）

1. **出现第二个 consumer**：除 `agent-remnote` 外，另一个可部署物/服务/仓库需要复用同一能力（例如 HTTP API 服务、GUI、独立 daemon）。
2. **需要独立发布节奏**：某模块（queue/ws/remdb-tools）需要独立版本与变更日志，且变更不应强制绑定 CLI 发布。
3. **测试与稳定性成熟**：internal 模块已有足够单测/契约测试，能在不依赖 CLI 的情况下独立验证。
4. **依赖树膨胀**：某模块依赖开始明显分化（例如 remdb-tools 引入 heavy deps，而 queue/ws 需要保持极简）。

## 3) 目标包划分（候选）

> 包名仅为建议；最终命名以仓库治理为准。

1. `@agent-remnote/queue`
   - 内容：`internal/queue/**`
   - 约束：不得依赖 Effect/CLI；对外只暴露 queue schema/dao 与调度语义。

2. `@agent-remnote/ws-bridge`
   - 内容：`internal/ws-bridge/**`
   - 依赖：`@agent-remnote/queue`
   - 约束：daemon 可部署；协议以 `docs/ssot/agent-remnote/ws-bridge-protocol.md` 为裁决。

3. `@agent-remnote/remdb-tools`
   - 内容：`internal/remdb-tools/**`
   - 约束：只读；不得写 `remnote.db`；hard-timeout 策略与错误可诊断性保持。

## 4) 迁移顺序（推荐）

1) **先抽 `queue`**（最小、依赖少、边界清晰）  
2) **再抽 `ws-bridge`**（依赖 queue；daemon 生命周期与 state file 行为要锁死）  
3) **最后抽 `remdb-tools`**（依赖较重，且更容易出现“展示层/markdown”耦合问题）

## 5) 迁移步骤（最小可执行）

对每个候选包，重复以下流程：

1. 明确 public surface（exports）与内部实现（internal），禁止 deep import。
2. 将 internal 模块内的 CLI 文案/输出/Effect 依赖清零（若仍存在，先通过适配层下沉到 `agent-remnote`）。
3. 新增/迁移最小测试：至少能在不运行 CLI 的情况下验证核心语义（queue/bridge/tool 的契约）。
4. 移动代码到 `packages/<new-pkg>/src/**`，并在 `agent-remnote` 里改为依赖该包（单向依赖）。
5. 更新 SSoT 锚点与 docs/architecture（避免文档漂移）。

## 6) 回滚策略

- 抽包过程遵循“先无损拆分，再改语义”。
- 任一阶段若出现不可控回归，可通过“回退为 internal 模块引用”恢复（前提是保持接口不变）。

## 7) 与本次重组的对齐点

- `specs/008-agent-module-reorg/data-model.md` 是抽包前提：它定义了模块边界与依赖方向。
- 若未来要抽包但 data-model 与代码漂移，必须先修正漂移（代码或文档二选一，禁止长期不一致）。
