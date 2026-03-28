# Research: 033-fixed-runtime-owner

日期：2026-03-28

## 决策 1：固定 URL 必须绑定到单一 claim，而不是只看端口是否活着

### Decision

引入一个 canonical fixed-owner claim，作为“当前固定 RemNote URL 预期属于谁”
的唯一真相源。

它定义：

- 预期 owner channel
- 预期 runtime root
- 预期 canonical port class
- 最近一次显式 transfer 的来源与时间

### Rationale

仅靠“端口通了”无法区分 stable 和 dev，也无法表达用户的明确意图。要做到
固定 URL 不变且 owner 不歧义，必须先有一个显式 claim。

## 决策 2：published install 是默认 stable owner

### Decision

发布版安装路径代表 stable owner。未显式 transfer 时：

- canonical fixed-owner claim 默认指向 stable
- `doctor --fix` 修复方向默认对齐 stable

### Rationale

用户的日常使用依赖的是 npm/Volta 安装版。它必须成为系统默认回落点，而不是
和 source runtime 平级竞争。

## 决策 3：source-tree 执行默认进入 isolated dev profile

### Decision

从源码仓库执行 CLI 时，默认解析到 isolated dev profile：

- 单独 runtime root
- 单独 pid/log/state/store
- 非 canonical 端口类

除非显式触发 fixed-owner transfer，否则它不碰 canonical fixed URL。

### Rationale

这是规避“本地 npm 这些进程冲突”的最小且稳定方案。默认隔离比默认抢占更安全。

## 决策 4：所有默认路径必须先收口为 runtime root，再派生具体文件

### Decision

不再把所有默认文件路径分别硬编码到 `~/.agent-remnote/*`。改为：

- 先解析 runtime root
- 再从 runtime root 派生 store / pid / log / state / statusline / config

### Rationale

如果路径派生不统一，stable/dev profile 不可能真正隔离，后续 owner metadata
也无法形成可比较的诊断。

## 决策 4a：control-plane root 与 runtime root 分层

### Decision

- `control_plane_root` 保持全局可发现，默认仍为 `~/.agent-remnote`
- stable runtime root 继续保留现有 stable 用户态根，避免迁移当前数据
- fixed-owner claim 放在 control-plane 子路径，而不是 runtime root 本身
- isolated dev runtime roots 放在 control-plane 下的独立命名空间

### Rationale

claim 不能依赖“当前 profile 先解析出来的 runtime root”才能被发现，否则
doctor、stack、source worktree 会陷入 bootstrap 循环。

## 决策 5：owner metadata 必须进入 pid/state，而不只存在内存里

### Decision

daemon/api/plugin 的 pid/state 元数据都要补 owner descriptor，例如：

- `owner_channel`
- `install_source`
- `runtime_root`
- `repo_root`
- `worktree_root`
- `port_class`
- `launcher_ref`
- `source_stamp`
- `plugin_dist_origin`

### Rationale

`doctor`、`status`、`pidTrust`、`takeover` 都是跨进程行为。没有 durable metadata，
就只能继续靠猜测命令行和 build id。

补充：

- `trusted`
- `claimed`
- `matches_fixed_owner_claim`

统一由 `doctor/status/config print` 在读取时计算，不进入 pid/state 持久化契约。

## 决策 5a：owner launcher 必须是一等模型

### Decision

引入 `OwnerLauncher` / `launcher_ref`：

- stable owner 可指向 published install / Volta shim
- dev owner 可指向具体 worktree entrypoint
- claim 和 live metadata 都引用 launcher，而不是假设“当前 CLI 自己”就是目标

### Rationale

没有 launcher，`stack takeover --channel stable` 从源码 worktree 执行时会继续拉起
源码版 runtime，无法真正恢复 stable owner。

## 决策 6：`doctor --fix` 只修“确定性问题”，不替用户猜 owner

### Decision

`doctor --fix` 可以自动处理：

- stale pid/state/claim
- deterministic claim-vs-live mismatch
- trusted owner metadata 明确不一致时的重启/清理
- canonical config rewrite

但不能处理：

- 无法证明哪个 live owner 才是正确目标
- 需要用户选择 stable 还是 dev 的 transfer 决策

### Rationale

用户希望更智能，但仍然要求非破坏性默认。claim 驱动的 deterministic fix 是边界。

## 决策 7：显式 transfer 属于 `stack`，不是 `doctor`

### Decision

固定 URL 的 owner 迁移属于 operational lifecycle，放在 `stack` 族：

- `stack takeover --channel dev|stable`

其中 “reclaim stable” 是 `--channel stable` 的同一路径，不再发明第二套命令面。

### Rationale

`doctor` 负责修确定性故障，`stack` 负责主动生命周期切换。这样命令职责更清晰，
也更符合 agent-first 的最小完备能力。

## 决策 8：dev profile 需要 deterministic isolated ports

### Decision

isolated dev profile 默认使用一组 deterministic 非 canonical 端口，而不是与
stable 共享 6789/3000/8080。

### Rationale

只隔离路径不隔离端口，仍会在启动和探活时制造假阳性冲突。isolated port class
是默认隔离的一部分。

## 决策 8a：isolated dev 的派生键按 worktree，而不是只按 repo

### Decision

isolated dev runtime root 和 isolated port class 都按规范化后的
`worktree_root` 派生。

claim / diagnostics 同时保留：

- `repo_root`
- `worktree_root`

### Rationale

本仓库大量使用 worktree。若只按 repo 派生，多个 worktree 会继续共享 dev root
和端口，默认隔离就会失效。

## 决策 8b：dev bootstrap 只继承必要控制信息，不复制完整 stable store

### Decision

- 全局用户配置继续留在 control-plane root，可被 dev 读取
- stable store 不整体复制到 isolated dev
- isolated dev 首次启动只允许显式或受控地 seed 必要的 workspace binding /
  config hints，不复制 queue、receipts、历史运行态

### Rationale

全量复制 stable store 会制造双真相；完全空白又会让本地调试 DX 断崖式下降。
“只继承必要控制信息”是更稳的折中。

## 决策 9：takeover 结果必须显式报告 RemNote reload requirement

### Decision

如果 fixed URL 转移后 plugin asset provider 改变，命令结果必须输出
`remnote_reload_required=true` 或等价明确字段。

### Rationale

固定 URL 不变，不代表 RemNote 一定立即刷新到新的 source plugin。这个边界要
明确，不然开发者会误判 takeover 是否生效。

## 决策 9a：dev takeover 必须先做 plugin artifact preflight

### Decision

`stack takeover --channel dev` 在 claim 转移前必须确认：

- source plugin artifacts 可用
- plugin launcher 可用
- plugin base URL 可被稳定构造

若任一失败，则 fail-fast，不得先改 claim。

### Rationale

否则 fixed URL 会先切到 dev，再因为缺产物进入坏状态。

## 决策 9b：packed install 与 source tree 并存必须有自动化验收

### Decision

最终验收必须包含一条自动化场景，同时覆盖：

- packed install CLI
- source-tree CLI
- stable default
- isolated dev startup
- dev takeover
- stable reclaim
- published launcher / Volta shim resolution

### Rationale

这是本 feature 最真实的冲突场景，不能只留在人工 smoke。

## 决策 10：实现顺序必须是 runtime-root -> owner metadata -> claim policy -> doctor/status -> transfer

### Decision

推荐实施顺序：

1. runtime root / profile resolution
2. owner metadata + trusted pid evolution
3. fixed-owner claim service
4. doctor/status exposure
5. explicit takeover flow
6. docs and verification

### Rationale

先有 profile 和 metadata，claim 才有可落盘的对象；先有 claim 和 doctor/status，
takeover 才不会是黑箱。
