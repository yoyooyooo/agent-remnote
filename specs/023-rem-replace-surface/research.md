# 研究记录：023-rem-replace-surface

日期：2026-03-16

## Decision 1：Canonical public replace family uses `rem replace`

### Decision

公开 replace 入口统一收敛到 `agent-remnote rem replace`。

### Rationale

- `rem` 作为对象名可以自然承载一个或多个 Rem
- `replace` 是动作，放在第二段最符合当前命令树风格
- 这能把“替换谁”和“替换哪一层”都下沉到参数层，降低命令分裂

### Alternatives Considered

- 继续使用 `rem children replace` + `replace markdown` 双主路径
  - 问题：同一动词分散在两套命令树里
- 新增 `rem selection replace`
  - 问题：把 target selector 升成命令 noun，不符合当前命令哲学
- 使用 `rem replace children`
  - 问题：第三段命令更像 surface 参数，放在子命令里会让语义和扩展性都变硬

## Decision 2：`selection` stays a target selector

### Decision

`--selection` 只保留为 target selector，不进入 canonical command noun。

### Rationale

- selection 是 UI 交互状态，不是持久对象类型
- 在 explicit ids 和 Host API-backed selection 都可行的前提下，selection 更适合作为输入便利项
- 这让命令可以保持 `object + action + parameters` 的稳定心智

### Alternatives Considered

- `rem selection replace`
  - 问题：命令 noun 被编辑器状态污染
- 只支持 explicit `--rem`
  - 问题：会逼调用方做额外读取，违背 write-first

## Decision 3：Replace layer is expressed through `--surface`

### Decision

replace 作用层通过 `--surface children|self` 公开表达。

### Rationale

- `children` 和 `self` 是 replace 语义的核心分叉
- 它们是基础能力维度，不是场景词
- 未来若扩展更多 replace layer，也能沿着同一参数继续长

### Alternatives Considered

- 继续拆成多个命令 noun
  - 问题：公开 surface 很快继续分裂
- 隐式推断 surface
  - 问题：多 target 与单 target 的含义会变模糊

## Decision 4：`preserve-anchor` remains children-only

### Decision

`--assert preserve-anchor` 只适用于 `surface=children`。

### Rationale

- `surface=children` 天然存在单一 anchor Rem
- `surface=self` 可以替换多个 sibling roots，此时没有稳定的单一 anchor 语义
- 强行复用同一断言名会制造误解

### Alternatives Considered

- 让 `surface=self` 也接受 `preserve-anchor`
  - 问题：需要重新定义“anchor”是谁
- 为 `surface=self` 发明新的 anchor 断言
  - 问题：超出本 feature 的最小范围

## Decision 5：Legacy replace surfaces stay available but lose canonical status

### Decision

本 feature 中，`rem children replace` 与 `replace markdown` 可以继续存在，但只保留 legacy / advanced 定位。

### Rationale

- 这样可以把 canonical 迁移和底层 primitive 复用拆开推进
- 能减少同一波改动里的爆炸半径
- 也符合 spec 中“older replace surfaces may remain during migration, but not as co-equal first-choice paths”的裁决

### Alternatives Considered

- 同一波硬删除所有旧 replace surface
  - 问题：实现和文档迁移成本更高，风险更集中
- 永久并列保留旧 surface
  - 问题：和 unified replace surface 目标相冲突

## Decision 6：Canonical `surface=self` maps to existing block-replace primitive

### Decision

`rem replace --surface self` 直接映射到现有 `replace_selection_with_markdown` primitive。

### Rationale

- 现有 runtime 已支持多 Rem、same parent、contiguous 校验、插回原位、backup 和回滚
- 本 feature 的重点是公开契约统一，不是重写插件执行层

### Alternatives Considered

- 新增一个新的 runtime primitive
  - 问题：重复已有能力，风险和工作量都更高

## Decision 7：Remote mode support follows target resolution capability

### Decision

`rem replace` 在 remote mode 下的支持范围取决于 target selector 是否能通过 explicit ids 或 Host API-backed selection 解析。

### Rationale

- 这和仓库现有 remote-mode 原则一致
- 可以让 canonical path 尽量 host-capable，同时保留 local-only 的 advanced selectors 在旧命令里

### Alternatives Considered

- 把 `surface=self` 整体标成 local-only
  - 问题：会把公开 canonical path 限制得过窄
- 把所有旧 advanced selectors 一次并入 canonical path
  - 问题：范围过大，风险上升
