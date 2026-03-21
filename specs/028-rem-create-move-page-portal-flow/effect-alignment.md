# Effect Alignment: 028-rem-create-move-page-portal-flow

日期：2026-03-20

## 本轮实现已经收敛的层次

### 1. CLI parsing

- `rem create` 与 `rem move` 的 option surface 仍然由 `@effect/cli` 定义
- 纯解析和动态组合校验已经分离
- command 文件主要保留：
  - option 声明
  - wait / dry-run 入口
  - receipt 组装

### 2. intent normalization / validation

- 复杂参数组合已经集中到 [`_promotion.ts`](../../packages/agent-remnote/src/commands/write/rem/_promotion.ts)
- 这里统一处理：
  - source model
  - title policy
  - content placement
  - portal placement
  - selection shape gate
  - anchor-relative placement resolution

这一步已经明显减少了 create / move handler 的 imperative branching 漂移。

### 3. runtime context resolution

- 本地 DB 依赖被限制在 promotion helper 内的少数函数：
  - title inference
  - anchor layout resolution
  - selection contiguous sibling resolution
- remote mode 下，这些本地依赖会 fail-fast

### 4. canonical planner

- create / move 都会先编译到 canonical action surface
- 再统一落到 compiled ops
- 这避免了“同一业务命令有多套隐藏 runtime path”

### 5. receipt builder

- `rem create` 与 `rem move` 已开始稳定返回：
  - `durable_target`
  - `portal`
  - `source_context`
  - `warnings`
  - `nextActions`
- `rem create` 已支持 portal 失败后的 partial-success receipt 恢复

## 仍然存在的残留问题

### 1. command 层仍有 receipt-specific branching

- `create.ts`
- `move.ts`

这两处已经比之前干净，但 receipt 组装逻辑还没有完全抽到共享 builder。

建议后续抽一个共享模块，例如：

- `src/commands/write/rem/_promotionReceipt.ts`

### 2. local-only anchor/selection resolution 仍嵌在 promotion helper

当前这块是可接受的过渡形态，但还不是理想的 Effect service 分层。

建议后续抽成独立 capability：

- `PromotionLayoutResolver`

负责：

- anchor -> `{ parentId, position }`
- selection -> `{ orderedRemIds, parentId, position }`
- single-source title inference

### 3. create partial-success 与 move warning-success 语义还不完全统一

- `rem create` 的 portal 失败当前可能走 explicit partial-success envelope
- `rem move` 的 leave-portal 失败当前表现为 success + warnings

这两者都合理，但机器契约还可以再统一。

建议后续裁决：

- 是否统一增加 `partial_success: boolean`
- 是否统一补 `status: 'partial_success'`

### 4. source_context 还不够丰富

当前 `source_context` 已经可用，但还没有完整覆盖：

- anchor rem id
- selection replaced range start/end
- explicit target ids

这属于可增强项，不阻塞当前交付。

## 结论

这次实现已经把最危险的漂移点收住了：

- 动态校验不再散落
- 业务命令不再各自持有独立 planner
- create / move / portal 的组合开始共享同一条 canonical surface

后续如果继续演进，优先级建议是：

1. 抽共享 receipt builder
2. 抽 `PromotionLayoutResolver`
3. 统一 partial-success 机器契约
