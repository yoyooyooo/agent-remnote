# Tasks：022-outline-aware-writes

## Workstream A：内容判定与结构约束

- [x] T001 定义内部 outline suitability 判定与写入样式枚举，落点：`packages/agent-remnote/src/kernel/write-plan/**` 或等价编译层
- [x] T002 定义公开结构断言模型：`single-root` / `preserve-anchor` / `no-literal-bullet`
- [x] T003 固化 `--assert` 第一版只支持固定断言集合，不引入表达式或用户自定义断言
- [x] T004 更新 `$remnote` skill，把“适合大纲化优先单根，不适合时正常写”固化到命令选择规则

## Workstream B：命令面增强

- [x] T010 新增 `backup list` 命令入口，落点：`packages/agent-remnote/src/commands/backup/list.ts`
- [x] T011 [P] 新增 `backup cleanup` 命令入口，落点：`packages/agent-remnote/src/commands/backup/cleanup.ts`
- [x] T012 为 `backup` 命令组增加注册与帮助面覆盖

## Workstream C：现有命令逻辑变更

- [x] T020 在 `daily write` 的内部 auto 路径中加入“单根 Markdown 默认不 bundle”的逻辑
- [x] T021 为 `rem children replace` 增加 `--selection`
- [x] T022 为 `rem children replace` 增加 `--backup none|visible`
- [x] T023 为 `rem children replace` 增加 `--assert <name>`（可重复）
- [x] T024 把 `replace markdown` 的帮助面与文档定位改为 advanced/local-only block replace
- [x] T025 保留 `replace markdown` 的现有块级语义，但从默认 Agent guidance 中移除
- [x] T026 为 `replace markdown` 明确 local-only / fail-fast 边界说明，而不是继续扩展为并列主路径
- [x] T027 统一 replace 成功返回值中的 backup 字段，保证 Agent 能判断是否需要后续治理

## Workstream D：backup registry 与 PowerUp

- [x] T030 新增 Store migration，创建 `backup_artifacts` 表
- [x] T031 新增 backup registry DAO / service
- [x] T032 在 replace 类执行路径中接入 registry 写入与状态更新
- [x] T033 插件侧注册或解析内部 PowerUp `agent-remnote backup`
- [x] T034 为 backup Rem 写入 PowerUp tag 与相关字段
- [x] T035 明确 orphan 判定逻辑，并让 `backup list` / `cleanup` 使用 Store DB 作为真相源

## Workstream E：backup 默认行为修正

- [x] T040 修复成功路径下残留可见 backup 节点的问题
- [x] T041 在 `backup=none` 默认值下，成功写入不允许留下可见 backup Rem
- [x] T042 在 `backup=visible` 模式下，允许保留 backup，但必须进入 registry，并带 `agent-remnote backup` 标记

## Workstream F：测试与文档

- [x] T050 为 `daily write` 的单根自动判断增加 contract tests
- [x] T051 为 `rem children replace --selection` 增加 contract tests
- [x] T052 为 `replace markdown` 的 local-only / fail-fast / advanced help 定位增加 contract tests
- [x] T053 为 `backup list` / `backup cleanup` 增加 contract tests
- [x] T054 为 replace 路径的 backup 默认行为增加 plugin / integration tests
- [x] T055 更新 `docs/ssot/agent-remnote/tools-write.md`
- [x] T056 更新 `README.md` / `README.zh-CN.md`
- [x] T057 在文档和 skill 中把 `table` 设为结构化数据写入主表面，并删除 `powerup` 写命令的公开写入定位
- [x] T058 回填 `specs/022-outline-aware-writes/acceptance.md`

## Workstream G：命令面分层与收口

- [x] T060 给命令面增加“主表面 / 辅助读取 / ops”分层说明
- [x] T061 在 Agent guidance 中把 `apply` / `rem` / `tag` / `portal` / `backup` 固化为主写入面，并把 `rem children replace` 明确为 canonical rewrite path
- [x] T062 删除 `powerup apply/remove/record/option/property` 的公开写入定位
- [x] T063 保留 `powerup list/resolve/schema` 作为读侧能力
- [x] T064 删除 `rem text` 别名，只保留 `rem set-text`

## 建议测试顺序

- [x] T070 先跑 unit / contract：命令参数、结构判定、backup registry
- [x] T071 再跑 plugin / integration：replace 路径、backup 清理、PowerUp 标记
- [x] T072 最后做本机 smoke：选中 Rem 的 children replace、报告型单根写入、backup cleanup dry-run / apply
