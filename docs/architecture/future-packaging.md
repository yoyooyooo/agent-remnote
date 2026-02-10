# 面向未来的拆包路线图（Modular Monolith → Hard Packages）

目标：在保持 `packages/agent-remnote` 作为单包 CLI 的前提下，确保内部模块边界足够“硬”，以便未来在出现真实驱动时能抽出真正有价值的子包（而不是“目录搬家式的 core”）。

## 为什么现在不拆包

当前没有第二个 consumer 复用 `queue/ws-bridge/remdb-tools`，且代码仍处在高频演进阶段。过早拆成多个 package 会带来：

- 边界不清：package 只是“换目录”，反而更难重构；
- 版本/发布/依赖管理成本上升；
- build/test gate 数量变多，减慢迭代速度。

因此当前策略是：**先在单包内把边界做硬（`src/internal/**`），等出现真实驱动再抽包**。

## 抽包触发条件（任一满足即可启动）

1. 出现第二个 consumer：除 CLI 外，另一个可部署物/服务/仓库需要复用能力（例如 HTTP API 服务、GUI、独立 daemon）。
2. 需要独立发布节奏：某模块需要独立版本与变更日志，不应强制绑定 CLI 发布。
3. 测试与稳定性成熟：internal 模块已有足够单测/契约测试，能在不依赖 CLI 的情况下独立验证。
4. 依赖树膨胀：依赖开始明显分化（例如 `remdb-tools` 引入 heavy deps，而 `queue/ws` 需要保持极简）。

## 目标包划分（候选）

> 包名仅为建议；最终命名以仓库治理为准。

1. `@agent-remnote/queue`
   - 来源：`packages/agent-remnote/src/internal/queue/**`
   - 约束：不得依赖 Effect/CLI；对外只暴露 schema/dao 与调度语义。

2. `@agent-remnote/ws-bridge`
   - 来源：`packages/agent-remnote/src/internal/ws-bridge/**`
   - 依赖：`@agent-remnote/queue`
   - 约束：协议以 `docs/ssot/agent-remnote/ws-bridge-protocol.md` 为裁决；daemon 生命周期与 state file 行为必须可验证。

3. `@agent-remnote/remdb-tools`
   - 来源：`packages/agent-remnote/src/internal/remdb-tools/**`
   - 约束：只读；不得写 `remnote.db`；hard-timeout 策略与错误可诊断性保持。

## 推荐迁移顺序

1) 先抽 `queue`（最小、依赖少、边界清晰）  
2) 再抽 `ws-bridge`（依赖 queue；行为约束更强）  
3) 最后抽 `remdb-tools`（依赖较重，且更容易出现“展示层/markdown”耦合问题）

## 迁移步骤（最小可执行）

对每个候选包，重复以下流程：

1. 明确 public surface（exports）与内部实现（internal），禁止 deep import。
2. 将模块内的 CLI 文案/输出/Effect 依赖清零（若仍存在，先通过适配层迁移回 `agent-remnote` 的 commands/services）。
3. 新增/迁移最小测试：至少能在不运行 CLI 的情况下验证核心语义（queue/bridge/tool 的契约）。
4. 移动代码到 `packages/<new-pkg>/src/**`，并在 `agent-remnote` 里改为依赖该包（单向依赖）。
5. 更新 SSoT 锚点与 `docs/architecture/**`（避免文档漂移）。

## 回滚策略

- 抽包过程遵循“先无损拆分，再改语义”。
- 任一阶段若出现不可控回归，可通过“回退为 internal 模块引用”恢复（前提是保持接口不变）。

## 与当前代码结构的对齐点

- internal 模块门面：`packages/agent-remnote/src/internal/public.ts`
- 边界约束：`specs/008-agent-module-reorg/contracts/module-boundaries.md`
- 模块映射：`specs/008-agent-module-reorg/data-model.md`

