当前仓库处在积极演进阶段。

采用 forward-only evolution：

- 内部实现可以重构，不需要为了历史代码做兼容层
- 外部契约仍然受 SSoT 约束，不能静默破坏
- 若确实要做 breaking change，必须在 `docs/ssot/agent-remnote/**` 与相关 `specs/**` 中显式写明
- 禁止长期保留“临时兼容”与“双真相源”

# agent-remnote

面向接手本仓库的人类与自动化代理的仓库级入口文档。
目标是用最短时间理解项目边界、工作流和当前硬约束。

## 一页结论

- 项目目标：把 RemNote 变成可编程知识库
  - 读：本地 RemNote SQLite
  - 写：`queue -> WS -> RemNote plugin SDK`
- 红线：禁止直接修改 RemNote 官方数据库 `remnote.db`
- 最高裁决点：`docs/ssot/agent-remnote/**`
- 远端模式开关：`apiBaseUrl`
  - 一旦配置，业务命令必须优先走宿主机 Host API
  - 仍依赖本地 DB 或本地文件系统的命令必须 fail-fast
- 当前宿主边界：
  - generic property 不支持程序化改类型
  - `table/powerup property set-type` 不支持
  - `table/powerup property add --type/--options` 不承诺创建 typed property
  - `table/powerup option add/remove` 只适用于本地 DB 中 `ft=single_select|multi_select` 的现成列

## 先读哪些文档

按这个顺序：

1. `docs/ssot/agent-remnote/README.md`
2. `docs/ssot/agent-remnote/ws-bridge-protocol.md`
3. `docs/ssot/agent-remnote/queue-schema.md`
4. `docs/ssot/agent-remnote/http-api-contract.md`
5. `docs/ssot/agent-remnote/ui-context-and-persistence.md`
6. `docs/ssot/agent-remnote/tools-write.md`

RemNote 官方资料：

- plugin docs: `https://plugins.remnote.com/`
- 本机提炼版可作为便利副本：`~/llms.txt/docs/remnote`
  - 这份本地镜像可能过时，也不是版本化来源
  - 仓库 SSoT 仍是最高裁决点，官方 plugin docs 作为外部参考
  - 任何实现、语义、协议变更都必须同步回写 `docs/ssot/agent-remnote/**`
  - 未定型方案放 `docs/proposals/**`

## 仓库结构与边界

- `packages/plugin/`
  - RemNote 插件执行器
  - 负责消费 WS/队列操作并调用官方 SDK 落库
- `packages/agent-remnote/`
  - Effect + `@effect/cli` 的 CLI 与运行时
  - 内含几个核心内部模块：
    - `src/internal/store/**`
    - `src/internal/queue/**`
    - `src/internal/ws-bridge/**`
    - `src/internal/remdb-tools/**`
- `docs/`
  - 契约、协议、运行手册
- `specs/`
  - 特性计划、验收、推进记录
- `scripts/`
  - 本地探活、排障、模拟脚本
- `skills/`
  - 项目内 skill

边界规则：

- 读本地 DB 的逻辑只放在 `internal/remdb-tools` 及其薄封装里
- 写入必须经由队列与插件，不得旁路
- Host API 是宿主机对外的统一读写面，不是第二套业务语义

## 运行模型

### 本地模式

- 读取直接访问 `remnote.db`
- 写入进入 store/queue，由 daemon 与插件协同消费

### 远端模式

- 调用方只配置 `apiBaseUrl`
- CLI 业务命令保持原样
- Host API 负责把远端调用收敛到宿主机能力

### workspace binding

- 一个 workspace 对应一个 `remnote.db`
- binding 持久化在 store DB 的 `workspace_bindings`
- 分辨来源按强度排序：
  - 显式 workspace
  - 既有 binding
  - live `uiContext.kbId`
  - 单候选 auto-discovery

## 当前硬约束

### 写入红线

- 不得直接写 `remnote.db`
- 不得创建 `parent=null` 的孤儿 Rem
- 不得承诺当前仓库支持“任意 RemNote 宿主内部能力”

### property / table 边界

- 公开 SDK 只有 `getPropertyType()`，没有 `setPropertyType()`
- 宿主 plugin router 也没有 `rem.setPropertyType` / `rem.setSlotType`
- 所以：
  - `set_property_type` 这条能力当前不可用
  - raw `apply` 也不能绕过这条限制
  - typed `add_property` 也不可用
- `option add/remove` 当前有前置门禁：
  - 目标 property 必须已经在本地 DB 中带有 `ft`
  - 允许值只有 `single_select` 或 `multi_select`

### Host API 信任边界

- 默认监听仍可配置为 `0.0.0.0`
- 但若暴露到宿主机之外，必须位于显式认证/授权边界之后
- 像 `POST /v1/write/apply` 这样的写端点默认视为敏感面

## 工作方式

### 文档优先

- 任何实现、协议、语义问题，默认先查 SSoT
- 若实现与 SSoT 不一致，优先修实现或同步修文档
- 禁止长期漂移

### 对外文本语言

- CLI 输出、错误信息、日志、HTTP 返回、tool schema 描述统一英文
- 代码注释默认英文
- 中文只用于：
  - 用户输入兼容
  - 词表 / 正则 / 匹配逻辑

### 路径与跨平台

- 所有本地路径统一用 `node:os` + `node:path`
- 禁止手写 `${home}/...`
- 用户输入路径要支持 `~` 展开并立刻 `normalize`

### 安全与命令风格

- 长驻进程要能自动结束
- 探活与一次性检查优先短超时
- 非用户明确要求，不做破坏性操作

## 变更同步规则

### 改 CLI

必须同步：

- `README.md`
- `README.zh-CN.md`
- `README.local.md`
  - 如果它引用了相关命令

### 改协议 / schema / 工具语义

必须同步：

- `docs/ssot/agent-remnote/**`

### 改规划或边界裁决

必须同步：

- 对应 `specs/**`
- 必要时补到本文件

## 验证要求

不要在没有本地证据的情况下声称“已完成”。

最少验证规则：

- 改 CLI：跑对应 tests
- 改 plugin：至少 `npm run typecheck --workspace @remnote/plugin`
- 改 plugin 写入逻辑：通常还要 `npm run build --workspace @remnote/plugin`
- 改 WS / queue / Host API：跑对应 contract / integration / runtime tests

## Turbo / 增量验证

- 根脚本已经提供 Turbo 入口：
  - 全仓：`npm run test:turbo`、`npm run typecheck:turbo`、`npm run lint:turbo`
  - 增量：`npm run test:turbo:affected`、`npm run typecheck:turbo:affected`、`npm run lint:turbo:affected`
- agent 默认规则：
  - 只改少量文件时，优先跑 `*:turbo:affected`
  - 改 CLI 契约、协议、runtime、发布链路、workspace 配置、共享脚本时，必须补一轮全仓验证
- `*:turbo:affected` 依赖本地 `origin/master` 基线；运行前可先：
  - `git fetch origin master`
- 若需要一次性全量收口，可用：
  - `npm run check:turbo`
  - `npm run check:turbo:affected`

## 常用路径与端口

- WS：`ws://localhost:6789/ws`
- Host API 默认端口：`3000`
- Store DB：`~/.agent-remnote/store.sqlite`
- WS state：
  - `~/.agent-remnote/ws.state.json`
  - `~/.agent-remnote/ws.bridge.state.json`
- daemon：
  - `~/.agent-remnote/ws.pid`
  - `~/.agent-remnote/ws.log`

## 常用命令

- CLI 开发：`npm run dev`
- WS bridge：`npm run dev:ws`
- WS 探活：`npm run ws:health`
- WS 拉起：`npm run ws:ensure`
- plugin build：`npm run build --workspace @remnote/plugin`
- agent-remnote tests：`npm test --workspace agent-remnote`
- agent-remnote typecheck：`npm run typecheck --workspace agent-remnote`

## 本机调试

### shim / worktree 注意事项

- 本机默认通过 `agent-remnote` 这个 shim 进入仓库。
- 若当前在 git worktree 中调试，必须确认 shim 指向的是当前 worktree 的 repo 入口地址。
- 若 shim 仍指向主工作区或其他 worktree，调试结果会落到错误的仓库上下文。
- 开始本机调试前，先检查“当前 shell 所在 worktree”和“shim 实际指向的 repo 入口”是否一致。

### 修改插件逻辑后的桌面端重载

- 若改动了 `packages/plugin/**`、WS 桥接接线、或任何依赖 RemNote 插件重新加载才能生效的逻辑，调试时要重载 RemNote 桌面端，让插件重新连接。
- 推荐直接用下面这段脚本：

```bash
osascript <<'APPLESCRIPT'
try
  quit app id "io.remnote"
end try
APPLESCRIPT
sleep 2
open -a /Applications/RemNote.app
for i in {1..20}; do
  if pgrep -x "RemNote" >/dev/null 2>&1; then
    echo "REMNOTE_RESTARTED"
    exit 0
  fi
  sleep 1
done
echo "REMNOTE_NOT_DETECTED"
exit 1
```

- 看到 `REMNOTE_RESTARTED` 才表示桌面端已经重新拉起。
- 若输出 `REMNOTE_NOT_DETECTED`，本轮重载不算成功，后续插件调试结论也不应采信。

## 对接本仓库的 agent 应该记住什么

- 这是一个“协议驱动 + SSoT 驱动”的仓库，不是先改代码再补文档的仓库
- remote mode 不是第二套命令体系，`apiBaseUrl` 只是业务命令的执行面切换
- `apply` 不能绕过 runtime guard
- property/table 这块目前存在明确宿主边界，不能脑补支持
- 若你发现“实现可以工作，但 SSoT 里没写”，默认把它视为未完成
