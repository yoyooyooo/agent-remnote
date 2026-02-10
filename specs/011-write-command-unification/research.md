# Research: Write Command Unification（现状盘点）

## Inventory（当前写入相关命令）

### 语义写入（面向日常意图）

- `agent-remnote write md`
- `agent-remnote write bullet`
- `agent-remnote write daily`
- `agent-remnote write replace text`
- `agent-remnote write replace block`

### raw 入队（面向“已有 ops”）

- `agent-remnote apply`
- `agent-remnote queue enqueue`
  - 计划收口为：`agent-remnote write advanced ops`（见 `specs/011-write-command-unification/contracts/cli.md`）

## Problems Observed

### 1) raw 入队入口重复 + 默认值不一致

- `apply` 默认 `notify=true`、`ensureDaemon=true`（通过 `--no-notify/--no-ensure-daemon` 关闭）
- `queue enqueue` 默认 `notify=false`、`ensureDaemon=false`（通过 `--notify/--ensure-daemon` 打开）

这会导致：

- Agent 很容易“选错命令 + 选错默认策略”，从而走更长链路（写完却没触发发送、需要再 ensure/notify）。

### 2) write 前置 inspect 的链路冗余

当写入命令本身已经具备静态校验、错误码与可行动提示时，inspect 不应成为默认前置步骤；它应当退化为“错误发生后的 next action”。

### 3) 写入后缺少“阻塞等待终态”的闭环能力

当前 write 成功通常只代表“已入队/已触发 sync”，但 Agent 仍需额外 `queue progress/inspect` 才能确认是否被 active worker 消费并 ack 成功；在 bridge/worker 卡住时，Agent 容易误判并重复写入。  
理想路径是：写入命令提供 `--wait/--timeout-ms`（或等价机制），在一次调用内闭环确认 txn 终态（或失败可诊断），避免“通过再写一次来确认”。

## Proposed Direction（本 spec 的裁决方向）

- 面向 Agent 的推荐策略：write-first（先写后诊断）。
- 面向 CLI 的收口策略：raw 入队只保留一个入口（`write advanced ops`）；其余命令按“场景→命令”映射归一化，减少歧义。
- 面向 write-first 的闭环策略：默认路径应支持 `write ... --wait`（或由 Skill/封装层默认开启等待），把 `queue progress/inspect` 退化为 next action/诊断工具。
