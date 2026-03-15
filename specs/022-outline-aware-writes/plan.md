# 实施计划：022-outline-aware-writes

日期：2026-03-14  
Spec：`specs/022-outline-aware-writes/spec.md`

本特性采用**命令面收敛 + 内部语义增强**的路线推进。

核心原则：

- 公开 CLI 尽量保持原子化、可组合、面向基础能力
- 场景判断和内容适配尽量放在 skill 与内部编译层
- 结果约束、目标选择、backup 策略可以作为公开参数存在
- backup 是补偿机制，不是默认用户可见产物
- Agent 主路径要收敛到低熵命令面，附属读取命令和运维命令要明确分层

## 目标状态

### 命令与参数总览

本轮规划里涉及到的新增/增强命令与参数，统一按下面这套口径理解。

#### 新增命令

- `agent-remnote backup list`
  - 作用：列出 backup artifact
  - 性质：对象级治理命令
  - 默认行为：只读，不修改任何内容
- `agent-remnote backup cleanup`
  - 作用：清理 orphan backup
  - 性质：对象级治理命令
  - 默认行为：dry-run，只有显式 `--apply` 才执行删除

#### 增强现有命令

- `agent-remnote rem children replace`
  - 新增 `--selection`
  - 新增 `--backup none|visible`
  - 新增 `--assert <name>`（可重复）
- `agent-remnote replace markdown`
  - 保留为 advanced/local-only 的块级替换入口
  - 不再作为并列的 Agent-primary 结构重写命令增强
- `agent-remnote daily write`
  - 不新增公开场景型参数
  - 只在内部增强“单根 Markdown 默认不叠加 bundle”的判断

#### 参数收紧

- `--assert`
  - 第一版只保留固定值：
    - `single-root`
    - `preserve-anchor`
    - `no-literal-bullet`
  - 不做表达式语言
  - 不做用户自定义断言

#### 命令分层

- Agent-primary primitives
  - `apply`
  - `rem ...`
  - `tag ...`
  - `portal ...`
  - `backup ...`
- Advanced / local-only
  - `replace markdown`
- 辅助读取命令
  - `daily rem-id`
  - `plugin current --compact`
  - `table show`
  - `powerup list`
  - `powerup resolve`
  - `powerup schema`
- Ops / lifecycle
  - `daemon ...`
  - `api ...`
  - `plugin ...`
  - `stack ...`
  - `queue ...`
  - `doctor`
  - `config ...`

#### 命令收口裁决

- `powerup` 写命令从公开写入面删除
- 结构化数据写入若存在 `table` / `powerup` 双表面，默认以 `table` 为唯一公开主写入面
- `rem text` 别名删除，只保留 `rem set-text`

#### 参数语义

- `--selection`
  - 含义：在 `rem children replace` 上，把当前 selection 的唯一根节点当作 anchor 目标
  - 角色：目标选择参数
  - 目的：让 Agent 不必先读出 remId 再回填
- `--backup`
  - 含义：控制 replace 类命令的 backup 行为
  - 值：
    - `none`：默认值；成功路径不保留可见 backup
    - `visible`：显式保留可见 backup
  - 角色：执行策略参数
- `--assert`
  - 含义：约束写入后的结果形态
  - 它不是“怎么理解内容”，而是“结果必须满足什么条件”
  - 典型值：
    - `single-root`
    - `preserve-anchor`
    - `no-literal-bullet`
  - 角色：结果断言参数
  - 目标：让 Agent 在最短链路里拿到更强的结构保证，而不是通过额外回读来猜测结果是否正确

### 命令新增

本轮规划只新增真正偏对象治理、且足够原子的命令：

- `agent-remnote backup list`
  - 列出 backup artifact
  - 默认只列 orphan 候选
  - 支持按状态、类型、年龄筛选
- `agent-remnote backup cleanup`
  - 清理 backup artifact
  - 默认 dry-run
  - 显式 `--apply` 后才真正删除

可选后续命令：

- `agent-remnote backup inspect`
  - 查看单个 backup 的来源与状态

### 现有命令逻辑变更

不新增公开的场景化高层命令，不新增公开 `--intent` / `--shape`。

本轮只增强现有基础命令：

- `daily write`
  - 不新增公开场景参数
  - 内部按内容形态决定是否保持单根
  - 输入本身已是单根 Markdown 时，默认不再叠加 bundle
- `rem children replace`
  - 新增 `--selection`
  - 新增 `--backup none|visible`
  - 新增 `--assert <name>`（可重复）
- `replace markdown`
  - 保留现有块级替换能力
  - 明确降级为 advanced/local-only surface
  - 不再作为默认 Agent-first rewrite path 推广

### PowerUp / backup 治理

- 新增内部 PowerUp：`agent-remnote backup`
- backup 的真实生命周期以 Store DB registry 为准
- PowerUp 只负责：
  - 在 RemNote 可见层里标记 backup Rem
  - 支持快速检索和人工清理

## Workstream A：内容判定与结构约束

目标：把“内容是否适合大纲化”的判断收进系统语义，但不直接变成公开 CLI 场景参数。

交付：

- outline suitability 的内部判定入口
- 内部写入样式结论，例如：
  - normal
  - single_root_outline
  - expand_existing
- 结构断言模型：
  - `single-root`
  - `preserve-anchor`
  - `no-literal-bullet`

## Workstream B：原子命令面增强

目标：让 Agent 用基础命令也能表达结构敏感任务，而不是靠新增场景化命令。

交付：

- `rem children replace --selection`
- `--backup none|visible`
- `--assert <name>`
- `backup list`
- `backup cleanup`

## Workstream C：现有命令行为改造

目标：保留现有高频命令，但让默认行为更贴近“最短路径 + 最优结构”。

交付：

- `daily write` 内部自动判断单根报告是否应跳过 bundle
- `replace` 成功路径默认不留下可见 backup
- 结构敏感任务允许一次轻量 `outline` 读取
- 返回值中补充结构断言与 backup 处理结果

## Workstream D：backup registry 与 PowerUp 联动

目标：把 backup 从“偶发可见垃圾”收口成“可治理补偿机制”。

交付：

- Store migration：新增 backup registry
- replace 类路径接入 registry 写入与状态更新
- 插件侧解析或注册 `agent-remnote backup`
- orphan 判定逻辑
- cleanup 状态机

## Workstream E：Skill / 文档 / 验收同步

目标：让 Agent 心智与 CLI 行为一致。

交付：

- `$remnote` skill 更新
- `docs/ssot/agent-remnote/tools-write.md` 更新
- README / README.zh-CN 更新
- 022 的 quickstart / acceptance 回填

## Workstream F：命令面分层与降级

目标：把当前命令面收敛成“主路径清晰、辅助读取命令分层、运维命令出圈”的结构。

交付：

- Agent-primary primitive 命令集合
- 辅助读取命令集合
- ops / lifecycle 命令集合
- `table` / `powerup` 双表面裁决
- `--assert` 收紧到小而固定的集合

## 关键设计裁决

### 1. 场景判断不进入公开 CLI

原因：

- `intent`、`shape` 这类参数更像 Agent 的内部推理结果
- 一旦公开，命令面会快速场景化和膨胀

结论：

- 不新增公开 `--intent`
- 不新增公开 `--shape`
- 这类判断保留在 skill 和内部编译层

### 2. `rem expand` 不作为公开命令引入

原因：

- 它表达的是场景，而不是基础原语
- 现有 `rem children replace` 只要补上 `--selection`、`--assert`、`--backup`，已经足够组合出“扩写当前选中 Rem”的最短路径

结论：

- 不新增公开 `rem expand`
- 用现有命令增强替代

### 3. `rem children replace` 是唯一规范化结构重写命令

原因：

- 它围绕明确对象“某个 Rem 的 direct children”展开，语义稳定
- 它天然匹配 expand-in-place / preserve-anchor 的主路径
- 它已经与当前 README / skill 的默认心智一致

结论：

- `rem children replace` 作为唯一 canonical 的 Agent-first 结构重写命令
- `replace markdown` 不再作为并列主路径

### 4. `replace markdown` 只保留为 advanced/local-only 块级替换入口

原因：

- 它表达的是 selection/block-range replace，而不是 anchor-preserving children rewrite
- 它当前依赖本地 selection/ref 解析，不具备与 canonical path 对称的 remote 语义
- 如果继续并列推广，只会重新制造双主路径

结论：

- `replace markdown` 保留为 advanced/local-only surface
- 它退出默认 Agent guidance、README 与 quickstart 主路径
- 后续只有在 block-range replace 是稳定公开需求时，才继续保留公开命令级定位

### 5. backup 的真相源是 Store DB，不是 PowerUp

原因：

- backup 生命周期属于写入补偿语义
- PowerUp 只能表达“这个 Rem 看起来像 backup”
- 是否 orphan、是否该删、是否保留，必须由 registry 与事务状态共同裁决

结论：

- Store DB registry 是事实表
- `agent-remnote backup` 是可见索引

### 6. 不做默认不可见长期 backup

原因：

- 不可见 backup 很容易退化成新的隐形孤儿
- 当前需求重点是成功路径干净，而不是长期保留恢复点

结论：

- 默认不保留 backup
- 显式 `visible` 时才保留可见 backup
- 异常残留通过 registry + PowerUp + cleanup 命令治理

### 7. `--assert` 保留，但严格收缩

原因：

- 它确实是在结构优化需求下暴露出来的能力
- 但它本质上仍是结果断言，不是场景语义
- 只要范围控制得住，它仍然符合原子化设计

结论：

- 保留公开 `--assert`
- 第一版只支持固定的 3 个断言
- 禁止把它扩展成通用断言语言

### 8. `powerup` 写命令删除，`table` 成为主表面

原因：

- `table` 与 `powerup` 在 record / option / property 上存在明显重叠
- 双表面会直接抬高 Agent 的选择成本
- `powerup` 更适合作为发现、解析、schema 查看这类读侧能力

结论：

- `table` 保留为结构化记录/列写入的唯一公开主表面
- `powerup` 写命令从公开写入面删除
- `powerup` 读命令保留

## 预计改动面

- CLI 帮助与命令注册
- `daily write`、`rem children replace`
- `replace markdown` 的帮助、文档与 guidance 降级
- 插件侧 backup 创建与删除逻辑
- Store migration
- backup registry DAO / service
- plugin-owned PowerUp 注册或解析
- Skill / 文档 / tests / 验收
