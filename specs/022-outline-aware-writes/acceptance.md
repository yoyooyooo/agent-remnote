# Acceptance：022-outline-aware-writes

日期：2026-03-15  
Spec：`specs/022-outline-aware-writes/spec.md`

## 验收状态

- 当前状态：PASS
- 已完成代码实现：
  - `daily write` 单根 Markdown auto 路径不再默认 bundle
  - `rem children replace` 支持 `--selection` / `--backup` / `--assert`
  - `replace markdown` 明确降级为 advanced/local-only 并在 remote mode fail-fast
  - `backup list` / `backup cleanup` 与 `backup_artifacts` Store DB registry
  - plugin 注册 `agent-remnote backup` PowerUp
  - `delete_backup_artifact` 改为子树自底向上删除，并保留短轮询校验
  - 前端插件已抽出可复用的 `safeDeleteSubtree` helper，删除策略收口到单点；默认按“阈值内整棵小子树直删，超阈值拆成多个小子树删除”执行
  - `delete_rem` 默认复用 `safeDeleteSubtree`，普通大树删除与 backup cleanup 共用前端安全删除路径
  - `delete_rem` 与 `delete_backup_artifact` 现已支持通过 op payload 动态传入 `max_delete_subtree_nodes`
  - 真实阈值探测后，前端默认 `max_delete_subtree_nodes` 已提升到 `100`
- 已完成本地验证：
  - `npm test --workspace agent-remnote -- --run tests/contract/daily-write-bulk.contract.test.ts tests/contract/rem-children-replace-selection.contract.test.ts tests/contract/replace-block.contract.test.ts tests/contract/backup-commands.contract.test.ts tests/contract/help.contract.test.ts tests/unit/write-plan.unit.test.ts tests/unit/backup-registry.unit.test.ts`
  - `npm test --workspace agent-remnote`
  - `npm run typecheck --workspace agent-remnote`
  - `npm test --workspace @remnote/plugin -- --run tests/children-replace-behavior.test.mjs tests/backup-powerup.test.mjs tests/runtime-reset.test.mjs`
  - `npm test --workspace @remnote/plugin`
  - `npm run build --workspace @remnote/plugin`
  - `npm run typecheck --workspace @remnote/plugin`
- 已完成本机 smoke：
  - `rem children replace --selection ... --dry-run`
  - `daily write --markdown @report.md --dry-run`
  - `backup list --state orphan`
  - `backup cleanup`
  - `backup cleanup --apply --no-notify --no-ensure-daemon`
- 已完成真实集成验证：
  - 测试页：`remnote://w/60810ee78b0e5400347f6a8c/uGynv9uHkCGC8U5Lx`
  - 当前选中 Rem：`PtUQTTSHnFN4lAZsD`（`风控应对共性`）
  - 真实 `--selection` 成功路径：
    - `rem children replace --selection --assert preserve-anchor --assert single-root --wait`
    - 结果：命中当前 selection，anchor 保留，页面根下未新增并列根，返回 `backup.policy=none` 且 `backup.deleted=true`
  - 真实失败断言路径：
    - `rem children replace --rem PtUQTTSHnFN4lAZsD --markdown '- bad root A\\n- bad root B' --assert single-root --wait`
    - 结果：事务失败，`queue inspect` 中底层错误为 `Assertion failed: single-root (created_roots=2)`，现有结构未被污染
  - 真实 visible backup 路径：
    - `rem children replace --selection --backup visible --wait`
    - 结果：可见 backup 被保留，`backup list --state retained` 可查到 registry 记录
  - 真实 cleanup 路径：
    - 对 retained backup 执行 `backup cleanup` dry-run 和 `backup cleanup --apply --wait`
    - 结果：dry-run 仅预览，apply 成功后 backup 节点从树中移除，registry 进入 `cleaned`
  - 后续增强：
    - `backup cleanup --backup-rem-id <id>` 已补齐
    - 结果：多个 retained backup 共存时，可精确命中指定 backup，不再依赖 `--limit 1` 猜测“最新一条”
  - 真实显式 `remId` 小树验证：
    - 在 `PtUQTTSHnFN4lAZsD` 下创建临时测试根 `jyVNRG0BoPakcXKuJ`
    - 跑通 `single-root` 成功、`single-root` 失败不落库、`visible backup -> registry -> cleanup apply`
    - 测试结束后已删除该测试根
  - 真实大子树 `backup=none` 路径验证：
    - 2026-03-15 在 `PtUQTTSHnFN4lAZsD` 下创建 fresh 测试根 `syd9N6KNWWznmZFWu`，标题 `cleanup-real-122808`
    - 先写入 70 分支大子树，再执行默认 `backup=none` 的 `rem children replace --wait`
    - 结果：返回 `backup.policy=none`、`backup.deleted=false`、`backup.hidden=true`、`backup.cleanup_state=pending`，并生成 `backup_rem_id=Jk7AQQTs1zWeiYSVq`
    - `rem inspect --id Jk7AQQTs1zWeiYSVq` 可确认 hidden backup 实体确实存在
    - `rem outline --id syd9N6KNWWznmZFWu` 只显示最终小树，不显示 hidden backup 子树
    - 对该 backup 执行 `backup cleanup --backup-rem-id Jk7AQQTs1zWeiYSVq --apply --wait`
    - 首轮结果：CLI 返回 `TXN_FAILED`，并在真实页面暴露出宿主的大树删除确认弹窗
    - 继续排查后确认根因有两层：
      - 宿主删除存在异步落库窗口，立刻复核会过早失败
      - 当 hidden backup 仍带整棵子树时，直接删根会触发宿主的大树二次确认
    - 修复后再次 reload 最新插件，并先用历史 pending 样本 `dI1DMSfofX8k9ZpeZ` 做收口
    - 结果：`backup cleanup --backup-rem-id dI1DMSfofX8k9ZpeZ --apply --wait` 成功，旧 registry 尾项被收成 `cleaned`
    - 随后在 `PtUQTTSHnFN4lAZsD` 下创建第二个 fresh 测试根 `8JlpHfVfK7l8a2Qm0`，标题 `cleanup-real-final-131151`
    - 同样先写入 70 分支大子树，再覆盖成小树，生成 hidden backup `mY5lsAsNdfFpx3vph`
    - `rem inspect --id mY5lsAsNdfFpx3vph` 可读到 hidden backup 实体，`rem outline --id 8JlpHfVfK7l8a2Qm0` 仍不显示 backup 子树
    - 对该 backup 第一次执行 `backup cleanup --backup-rem-id mY5lsAsNdfFpx3vph --apply --wait`
    - 最终结果：CLI 直接成功，`rem inspect --id mY5lsAsNdfFpx3vph` 返回 not found，`backup list --state pending` 为空，Store DB `backup_artifacts.cleanup_state=cleaned`
    - 这轮真实页验证确认最终修正成立，hidden backup cleanup 已能绕开宿主的大树确认门并在首次执行中完成

## 待验收覆盖矩阵

### 功能需求（FR）

| ID | 目标结论 | 计划证据（实现/测试） | 当前状态 |
| --- | --- | --- | --- |
| FR-001 | 写入前支持内部 outline suitability 判定 | 编译层 + tests | PASS |
| FR-002 | 报告型内容默认单根 | `daily write` contract + skill/docs | PASS |
| FR-003 | 已是单根 Markdown 时不额外叠 bundle | `daily write` contract tests | PASS |
| FR-004 | 不适合大纲化时允许正常写法 | CLI tests + smoke | PASS |
| FR-005 | canonical rewrite path 支持 expand-in-place | `rem children replace --selection` + tests | PASS |
| FR-006 | canonical expand-in-place path 支持 current selection 直达目标 | `rem children replace --selection` contract tests + smoke | PASS |
| FR-007 | expand-in-place 默认不在页面根下长并列节点 | integration / smoke | PASS |
| FR-008 | 公开 CLI 保持原子化、可组合 | 命令面 + docs | PASS |
| FR-009 | 支持目标选择、backup 策略、结构断言这些基础控制 | 参数层 + tests | PASS |
| FR-010 | 支持结构断言表达 | 参数层 + write pipeline tests | PASS |
| FR-011 | 支持最小结构读取路径 | 命令链路 tests | PASS |
| FR-012 | 默认成功与显式 backup 行为分离 | plugin / integration tests | PASS |
| FR-013 | backup 行为可显式禁用或排除默认可见结果 | `--backup` tests | PASS |
| FR-014 | Agent guidance 明确 canonical 与 advanced/local-only 路径分层 | `$remnote` skill + docs + quickstart | PASS |
| FR-015 | Skill 与 CLI 路由一致 | skill review + smoke | PASS |
| FR-016 | 默认写法不依赖隐藏过渡逻辑 | code review + tests | PASS |
| FR-017 | 新增 `backup list` / `backup cleanup` | CLI help + contract tests | PASS |
| FR-018 | replace 类写入公开 backup 控制，成功默认不留可见 backup | `--backup` tests + plugin/integration | PASS |
| FR-019 | 存在内部 PowerUp `agent-remnote backup` | plugin registration evidence | PASS |
| FR-020 | intentional backup Rem 会打上 `agent-remnote backup` 标记 | integration / smoke | PASS |
| FR-021 | backup metadata 足够支撑诊断与清理 | registry + UI metadata tests | PASS |
| FR-022 | Store DB 是 backup 真相源 | DAO / cleanup tests | PASS |
| FR-023 | Store DB 有 backup registry | migration + DAO tests | PASS |
| FR-024 | 默认成功路径不需要可见 backup 持续存在 | plugin tests | PASS |
| FR-025 | `backup list` 支持按状态、类型、年龄过滤 | contract tests | PASS |
| FR-026 | `backup cleanup` 默认 dry-run | contract tests | PASS |
| FR-027 | 区分 auto cleanup / retained / orphan | registry tests | PASS |
| FR-028 | 内部 PowerUp 命名统一以 `agent-remnote` 开头 | docs + implementation evidence | PASS |
| FR-029 | 命令面明确分层为主原语 / advanced local-only / 辅读 / ops | docs + skill + help review | PASS |
| FR-030 | Agent 主写入面收敛到低熵原语集合，且不再把 `replace markdown` 作为并列默认路径 | skill + docs + smoke | PASS |
| FR-031 | `--assert` 第一版保持固定小集合 | 参数层 + help + tests | PASS |
| FR-032 | `--assert` 初始集合仅含 `single-root` / `preserve-anchor` / `no-literal-bullet` | help + tests | PASS |
| FR-033 | `table` / `powerup` 双表面完成主次裁决 | docs + skill + command review | PASS |
| FR-034 | `powerup` 读能力保留、写能力从公开写入面删除 | docs + skill | PASS |
| FR-035 | `daemon/api/plugin/stack/queue` 保持可用但不进入 Agent 主写入面 | docs + skill | PASS |

### 非功能需求（NFR）

| ID | 目标结论 | 计划证据 | 当前状态 |
| --- | --- | --- | --- |
| NFR-001 | 结构敏感任务默认链路更短 | 命令链路对比 + smoke | PASS |
| NFR-002 | 相同输入形态有稳定路由结果 | contract tests | PASS |
| NFR-003 | 默认成功结果低噪音 | replace / daily write / backup tests | PASS |
| NFR-004 | 用户心智模型稳定 | docs / skill / quickstart | PASS |
| NFR-005 | docs 与 skill 同步更新 | 文档 diff | PASS |
| NFR-006 | 保持 write-first 原则 | code review + tests | PASS |
| NFR-007 | backup 治理默认低噪音 | backup tests | PASS |
| NFR-008 | cleanup 保守且可诊断 | backup cleanup tests | PASS |
| NFR-009 | Agent 选命令的熵进一步下降 | skill / docs / smoke | PASS |
| NFR-010 | 参数增长保持克制，不引入场景型公开 flag | help / docs / command review | PASS |

### 成功标准（SC）

| ID | 目标结论 | 计划证据 | 当前状态 |
| --- | --- | --- | --- |
| SC-001 | 报告型单根输入写入后仍只有一个顶层根节点 | smoke + contract tests | PASS |
| SC-002 | expand-in-place 任务保留 anchor 且不新增并列根节点 | smoke + integration tests | PASS |
| SC-003 | prose-like 输入默认可正常写入 | CLI tests | PASS |
| SC-004 | 结构敏感写入最多只需一次轻量结构读取 | command path review + smoke | PASS |
| SC-005 | 默认成功写入不留可见 backup | plugin tests | PASS |
| SC-006 | skill 和 docs 明确写出 outline suitability、canonical `rem children replace` 路径与 advanced/local-only `replace markdown` 定位 | 文档检查 | PASS |
| SC-007 | `backup list` 能列出 backup artifact | contract tests | PASS |
| SC-008 | `backup cleanup` 支持 dry-run 与 apply 两种模式 | contract tests | PASS |
| SC-009 | Agent-primary 命令指导收敛到小型原语集合，且 `replace markdown` 明确退出并列默认路径 | skill / docs review | PASS |
| SC-010 | `--assert` 维持固定小集合，不演变成表达式语言 | help / tests | PASS |

## 计划验证命令

```bash
npm run typecheck --workspace agent-remnote
npm test --workspace agent-remnote
npm run typecheck --workspace @remnote/plugin
npm test --workspace @remnote/plugin
```

本机 smoke 预期命令：

```bash
agent-remnote --json plugin current --compact
agent-remnote --json rem children replace --selection --assert preserve-anchor --markdown - --wait
agent-remnote --json daily write --markdown - --wait
agent-remnote --json backup list --state orphan
agent-remnote --json backup cleanup --state orphan
```

## 回填要求

- 实现完成后，把 `PENDING` 替换为 `PASS` / `PARTIAL` / `FAIL`
- 对每项回填对应文件、测试、命令输出摘要
- 若最终不引入某个字段或策略，需要在此写明裁决和替代方案
