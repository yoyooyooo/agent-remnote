# Research: Effect Native Upgrade（盘点与设计取舍）

**Date**: 2026-01-25  
**Spec**: `specs/009-effect-native-upgrade/spec.md`

## 目标复述（与约束）

- 目标：把 CLI/daemon 的异步与副作用收口到 Effect runtime；提供统一的取消/超时/节流/背压能力。
- A：tmux statusLine 改为读取缓存文件（允许）。
- B：daemon 不可达时也要刷新（至少 `↓N`），以直观体现“队列待同步数”。
- 重要边界：引入 **可移植内核** `packages/agent-remnote/src/kernel/**`（不依赖 Node/Effect），并用 Actor（runtime）解释执行。

## 基线盘点：当前“非 Effect 异步/副作用”热点

### 1) ws-bridge（daemon/bridge）

- 文件：`packages/agent-remnote/src/internal/ws-bridge/bridge.ts`
- 现状：大量 WS callback + `setInterval`（心跳/踢人）+ `setTimeout`（search 超时、状态写入节流等）
- 风险：生命周期与资源释放依赖手工 try/catch；难以用 TestClock 控制；并发触发点多，容易产生刷新风暴或不可诊断的静默失败。

### 2) WsClient（CLI → daemon 的 WS client）

- 文件：`packages/agent-remnote/src/services/WsClient.ts`
- 现状：`new Promise` + `setTimeout` + `ws.on(...)` 自建一次性连接/请求-响应/超时。
- 风险：取消语义弱；资源回收依赖手工 terminate；难以组合（如 retry/backoff/timeout 叠加）。

### 3) 子进程执行（wechat/outline 等）

- 文件：`packages/agent-remnote/src/commands/wechat/outline.ts`（子进程 + timer + stdout/stderr 聚合）
- 风险：多处重复实现“超时/收集输出/kill”；难以统一背压与资源释放。

### 4) worker_threads 硬超时（DB 搜索）

- 文件：`packages/agent-remnote/src/internal/remdb-tools/searchRemOverview.ts`
- 现状：Worker + timer 硬超时，超时后 terminate。
- 风险：跨模块复用困难；hard-timeout 的实现细节分散，难以统一测试与诊断。

### 5) 其他调度/异步点

- `packages/agent-remnote/src/services/LogWriter.ts`：内部队列 + `setImmediate` flush
- plugin 侧（可选）：`packages/plugin/src/bridge/runtime.ts`：watchdog/poll/withTimeout（不在 CLI/daemon，但同类问题）

### 6) 结构性隐式耦合（需要在 009 阶段顺手切断）

- “通过 env 注入配置”的隐式耦合：
  - 示例：daemon 启动路径里通过 `process.env.REMNOTE_QUEUE_DB = ...` 让底层读取到 queue db path。
  - 风险：跨模块参数传递不可见；未来抽包/替换实现时难以定位默认值来源；也不符合“services 统一接线”的目标态。

- commands 层散落的文件 IO：
  - 示例：`write md` / `write daily` / `write replace block` 等命令直接 `fs.readFile(...)`。
  - 风险：文件 spec（`@file`/`-`/`~`）解析与错误码/上限会分叉；不利于统一测试与安全门禁。

- timer/callback 中 `Effect.runPromise(...)`：
  - 示例：supervisor 里 `setTimeout(() => Effect.runPromise(...))`。
  - 风险：绕开 Scope/取消语义；难以用 TestClock 做稳定测试；容易形成“半 Effect/半命令式”的灰区实现。

## 关键设计取舍（本需求的“完美点”）

### 取舍 1：内核是否可移植（portable kernel）？

结论：**必须可移植**。009 起以 `kernel/**` 为纯内核：不依赖 Node/Effect，不读 env，不触达 IO 原语；所有 IO 迁移到 `services/**`，长驻协调迁移到 `runtime/**` Actor。

影响：
- ws-bridge/supervisor/statusLine 等“长驻 + timers + IO”必须拆分为：`kernel/**`（状态机）+ `runtime/**`（Actor）+ `services/**`（平台边界）。
- 需要更新门禁：新增 kernel 可移植性 gate，并把 internal 视为 legacy（禁止新增）。

### 取舍 2：statusLine 的计算与 tmux 渲染模型

结论：**tmux 读取缓存文件**（避免每次渲染 spawn node），并由 `StatusLineController` 统一更新文件 + 触发 `tmux refresh-client -S`。

关键点：
- daemon 可达：优先由 daemon 合并刷新（coalesced）。
- daemon 不可达：CLI fallback 直接更新文件（至少写 `↓N`），并触发刷新（符合 B）。

### 取舍 3：跨进程节流与“不过于频繁”

结论：把节流/背压收口到 `StatusLineController`（Actor）；CLI fallback 也使用同一节流策略（避免脚本高频调用导致风暴）。

实现建议（后续实现阶段）：
- `Queue.sliding(1)`/`Hub` 作为背压；只保留“需要刷新”这一事实。
- `minInterval` + 合并 burst；默认 250ms，可 env 覆盖。

## Open Questions（需要在实现前裁决）

已裁决（落到 contracts）：
- statusLine：默认只写一行文本；debug 模式可额外写 JSON sidecar（可诊断）。
- daemon 不可达：statusLine 基础片段必须体现不可用（例如 `WSx`），并在 `queueOutstanding>0` 时追加 `↓N`。
- 内核：必须可移植（见 `contracts/portable-kernel-and-actors.md`）。
