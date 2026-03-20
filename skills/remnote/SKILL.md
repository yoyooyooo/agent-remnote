---
name: remnote
description: 'Use this skill for any RemNote-specific read/write or local plugin-loading task. Trigger it whenever the user mentions RemNote, Daily Note, 今日笔记, 当前 page/focus/selection, remId, 替换/清空/追加子级, queue/WS/plugin sync, sent=0, powerup/table/property changes, local Developer URL / plugin server (`plugin serve|ensure|status|logs|stop`), remote `apiBaseUrl` mode, recent activity recap, or asks to 整理成大纲 / 展开讲讲 / 继续往下分层 / 单一主线写入 / 由浅入深组织内容, even if they only say “记到笔记里” or “查一下当前 page”. Prefer the shortest `agent-remnote` business command first, such as `plugin current --compact`, `rem replace`, `rem children replace|clear|append|prepend`, `daily write`, `rem outline`, `db recent`, `daily rem-id`, or `plugin ensure`. Prefer outline-first writing when the content is naturally outline-shaped; keep normal writing when it is not. Only escalate to `apply --payload` for true dependency chains, and only add wait/verify when the user explicitly asks or the next step depends on completion.'
---

# RemNote

## Core Goal

用最短路径完成 RemNote 读写。

优先级固定如下：

1. 能一步完成的业务命令，直接一步完成。
2. 默认只发起写入，不等待消费完成。
3. 默认不做额外读取、不做事前 inspect、不做写后验证。
4. 只有多步依赖或用户明确要求时，才进入 `apply`、`queue wait`、`rem outline` 这类更重路径。

补充约束：

- 进入 wait-mode 后，优先读 `id_map`，不要把 wrapper-specific `rem_id` / `portal_rem_id` 当成主机器契约。
- 做 recap / 最近活动查询时，优先 `db recent --days ... --kind ... --aggregate ...`，不要为场景临时发明新 CLI 形状。
- 做结构验证时，优先 `rem outline --format json`，读取 `tree[].kind` 与 `tree[].target`。

命令面分层固定如下：

1. Agent-primary
   `apply`、`rem ...`、`daily write`、`tag ...`、`portal ...`、`backup ...`
2. Structured-data primary write surface
   `table ...`
3. Advanced/local-only
   `replace markdown`
4. Auxiliary reads
   `daily rem-id`、`plugin current --compact`、`powerup list/resolve/schema`、`table show`
5. Ops / lifecycle
   `daemon ...`、`api ...`、`stack ...`、`queue ...`、`doctor`、`config ...`

## Hard Rules

- 禁止直接写入 RemNote 官方数据库 `remnote.db`。
- 所有写入必须走 `queue -> WS -> plugin SDK`。
- 结构化内容默认用 Markdown 无序列表，不要把聊天原文直接落库。
- 先判断内容是否适合写成大纲：适合时优先大纲化写入，不适合时按普通结构写入，不要强行改造成单根大纲。
- 调研报告、会议纪要、总结、分析类长内容，默认写成单一顶层根节点。
- 单个节点尽量可独立阅读，不要把一段连续论证拆成多个互相补全的残句节点。
- 同一层节点尽量保持语义同构，不要把定义、问题、步骤、结论混在同一层。
- 子节点用于展开父节点，不用于补完父节点的半句话。
- 已经是单根结构的 Markdown，默认不要再额外包一层容器；写 Daily Note 时优先显式 `--bulk never`。
- 只有内容天然是素材集合、用户明确要求保留多个入口、或确实不适合单根叙事时，才允许多个并列根节点。
- 默认不要加 `--wait`。
- 默认不要在写入前先 `inspect`、`search`、`outline`。
- 用户给了明确 `remId` / `parentRemId` 时，直接写，不要再多查一轮。
- `powerup` 的读命令可以直接用，写命令不要作为默认 Agent 主路径。
- 结构化数据写入默认走 `table ...`，不要优先走 `powerup apply/remove/record/option/property`。
- `table/powerup property set-type` 当前不支持，`property add --type/--options` 也不能承诺建出真正的 typed property。
- `table/powerup option add/remove` 只适用于已经在 UI 中存在的 `single_select` / `multi_select` 列；CLI 会先读本地 DB 检查 `ft`。
- `table/powerup option add/remove` 现在可以在 remote `apiBaseUrl` 模式下通过 Host API 透明执行，但校验仍然发生在宿主机的本地 DB 上，不是调用方本地镜像。
- 真正“宿主做不到”的是 generic property type mutation；仍然 host-only 的其它命令大多只是还没铺到 Host API，不要混为一谈。

## Outline Suitability

不是所有文字都适合直接变成大纲。

默认先做一次智能判断：

- 如果内容满足下面的判断标准，优先整理成分层大纲。
- 如果内容不满足，保留正常写法，不要为了“看起来规整”强行拆成树。

### 判断标准

- 节点可独立阅读
  - 单个节点脱离兄弟节点后，仍然基本可理解。
  - 缺失某个兄弟节点，不会让其他节点变成残句或语义不完整。
- 层级关系明确
  - 父节点和子节点之间有稳定的展开关系。
  - 子节点是在细化父节点，不是在补完父节点缺失的论证部分。
- 同层语义同构
  - 同一层的节点尽量属于同一种语义类型。
  - 例如同一层都写“分类项”“步骤项”“结论项”“证据项”。
- 可继续展开
  - 节点往下扩写时，能自然形成新层级。
  - 展开后仍然保持局部可读，而不是把原句切碎。

### 适合直接写成大纲的内容

- 分类说明
- 分步骤流程
- 调研结论
- 对比分析
- 结构化知识卡片
- 会议纪要
- 总结与复盘

### 不适合直接写成大纲的内容

- 强依赖上下文的连续论证文本
- 修辞性很强的长段散文
- 缺失任何一段就不连贯的链式推导

### 转换策略

- 连续论证文本先重写为“问题 / 假设 / 推导 / 结论 / 证据”之类的结构，再入库。
- 长段叙述先抽主题句，再把细节下沉成子级。
- 只有当内容本身具备局部闭包和层级关系时，才优先单根大纲化。

## Outline Shape Rules

### 报告型内容

- 默认只有一个顶层根节点。
- 二级节点写主题块，例如“总结”“背景”“方法”“结论”“风险”“建议”。
- 三级节点写原子结论。
- 四级节点再放例子、证据、步骤、边界条件。

### 扩写型内容

- 保留现有标题 Rem 作为锚点。
- 默认重写这个 Rem 的 direct children，而不是在页面根下新建并列节点。
- 从上到下保持“主题 -> 子题 -> 细节”的递进。

### 同层约束

- 不要在同一层同时放定义、问题、例子、步骤、结论。
- 如果同层语义明显混乱，先重组结构，再写入。

## Command Selection Ladder

按这个顺序选命令：

1. 用户在说“整体替换全部子级 / 所有 chunks / 覆盖整个 section”：
   用 `rem children replace`
2. 用户在说“清空这个 section / 清空子级”：
   用 `rem children clear`
3. 用户在说“插到最上面 / 置顶插入”：
   用 `rem children prepend`
4. 用户在说“追加 / 添加子项 / 塞到下面”：
   用 `rem children append`
5. 用户是在扩写当前 Rem / 选中的 Rem / 某个现有标题，并且目标是“继续往下分层 / 展开讲讲”：
   用 `rem children replace`
6. 用户只是说“写到今天日记里”：
   用 `daily write`
7. 只有后一步依赖前一步新建结果时：
   用 `apply --payload`

补充裁决：

- `rem children replace` 是默认的 canonical 结构重写命令。
- 不要把 `replace markdown` 当成并列默认路径。
- 只有当用户明确要“替换当前选中的 sibling blocks / block range”，或者任务本质上是 selection-level surgery 时，才考虑 `replace markdown`。
- 若任务目标是“保留一个现有标题/Rem，自身不动，只重写其 children”，一律优先 `rem children replace`。

如果一个 prompt 同时匹配多条，优先更强语义：

- `replace` 高于 `append`
- `clear` 高于 `append`
- “扩写现有 Rem” 高于 `daily write`
- `daily write` 高于“先解析 DN 再 append”

## Fastest Path Router

### 1. 已知目标 Rem，追加子级

默认命令：

```bash
cat <<'MD' | agent-remnote --json rem children append --rem <parentRemId> --markdown -
- title
  - point
MD
```

适用：

- “追加一段结构化内容”
- “把这段笔记塞到某个页面下面”
- “给这个 rem 下面加几条子项”

### 2. 已知目标 Rem，顶部插入子级

默认命令：

```bash
cat <<'MD' | agent-remnote --json rem children prepend --rem <parentRemId> --markdown -
- title
  - point
MD
```

适用：

- “插到最上面”
- “置顶插入”

### 3. 已知目标 Rem，整体替换全部 direct children

这是高频命令。

它也是默认的 canonical rewrite path。

默认命令：

```bash
cat <<'MD' | agent-remnote --json rem children replace --rem <parentRemId> --markdown -
- title
  - point
MD
```

适用：

- “无脑替换子级”
- “把这个 rem 里的所有 chunk 全部替换成这段 Markdown”
- “覆盖整个子树入口层”

默认不要先读旧 children，也不要手工 `delete + append`。

默认也不要退到 `replace markdown`；后者只保留给高级块级替换场景。

如果用户说的是“展开当前选中的这个 Rem”或“就地继续往下分层”，优先：

```bash
cat <<'MD' | agent-remnote --json rem children replace --selection --assert preserve-anchor --assert single-root --markdown -
- title
  - point
MD
```

补充规则：

- 需要显式保留 backup 时，再加 `--backup visible`
- 默认不要加 `--backup visible`
- `--assert` 第一版只用固定集合：`single-root`、`preserve-anchor`、`no-literal-bullet`

### 4. 已知目标 Rem，清空 direct children

默认命令：

```bash
agent-remnote --json rem children clear --rem <parentRemId>
```

适用：

- “清空这个 rem 的子级”

注意：

- 这只清空 direct children。
- 不会删目标 Rem 自己。
- 要删整个 Rem，用 `rem delete`。
- `rem delete` 现在由插件侧默认走 `safeDeleteSubtree`：小子树直接整棵删除，超阈值的大树切成多个阈值内的小子树后再删。
- 需要试探阈值时，直接给 `rem delete` 或 `backup cleanup` 传 `--max-delete-subtree-nodes <n>`，不用为了改阈值反复 reload 插件。

### 5. 改已有 Rem 自己的文本

默认命令：

```bash
agent-remnote --json rem set-text --rem <remId> --text "..."
```

### 6. 短纯文本新增

默认命令：

```bash
agent-remnote --json rem create --parent "<parentRemId>" --text "..."
agent-remnote --json daily write --text "..."
```

只适用于短纯文本。

如果输入看起来像结构化 Markdown，不要走这条路。

### 7. 写 Daily Note

结构化内容：

```bash
cat <<'MD' | agent-remnote --json daily write --markdown -
- journal
  - item
MD
```

短纯文本：

```bash
agent-remnote --json daily write --text "..."
```

裁决：

- 用户只是说“写到今天日记里”，优先 `daily write`。
- 用户要写到今天日记里的某个具体小节或具体 Rem 下面，先拿当天条目 Rem ID，再用 `rem children ...`。
- 写入前先判断内容类型：
  - 捕获型：几条碎片信息，可允许多个根节点。
  - 报告型：必须单根，默认 `daily write --markdown ... --bulk never`。
  - 扩写型：不要写 DN 根，优先改写现有 Rem 的 children。
  - 汇总型：优先单根，再按主题块展开。
- 如果内容是“调研报告 / 会议纪要 / 总结 / 长段结构化笔记”，默认先整理成**单一顶层根节点**的 Markdown，再执行 `daily write --markdown --bulk never`。
- 如果 Markdown 本身已经表达了单一主线结构，不要再额外包一层容器式根节点。
- 如果 `daily write --markdown` 的输入已经是单根大纲，默认不要再显式加 bundle title，也不要强制 bundle。
- 不要为了“看起来更安全”就默认再加一层 bundle；双层单根通常是噪音。
- 只有用户明确要求导入容器，或输入本身没有自然单根、又必须整体包成一篇时，才考虑额外容器。

### 8. 多步依赖写入

只有在以下情况才用 `apply --payload`：

- 后一步依赖前一步新创建的 Rem
- 需要同一个 envelope 里表达多个动作
- 需要 `kind:"ops"` 做 advanced/debug
- 用户下一步还要继续引用这次新建出来的节点

强规则：

- 不要用“先写入，再 `search` / `outline` 回读新节点 ID”的两步路径来代替依赖型 `apply`
- 如果 prompt 里已经出现“下一步要继续引用这个新节点 / 后一步依赖前一步 / 一次发起多步”，直接进入 `apply`
- 如果用户要的是“创建一个命名根节点，再往它下面挂 children”，不要偷懒改成“直接 append 到原 parent”

结构化 actions 示例：

```bash
agent-remnote --json apply --payload @plan.json
```

`plan.json`：

```json
{
  "version": 1,
  "kind": "actions",
  "actions": [
    {
      "as": "root",
      "action": "write.bullet",
      "input": {
        "parent_id": "id:<parentRemId>",
        "text": "Root"
      }
    },
    {
      "action": "rem.children.append",
      "input": {
        "rem_id": "@root",
        "markdown": "- child"
      }
    }
  ]
}
```

不要把单步写入也升级成 `apply`。

## Table / Property Boundaries

这块需要单独记住，避免选错命令：

- 如果用户要“把某列改成单选/多选/日期/数字”：
  - 不要调用 `table property set-type`
  - 不要调用 `powerup property set-type`
  - 直接说明当前宿主未暴露 property type mutation 能力
- 如果用户要“创建一个带类型的列”：
  - 不要用 `table property add --type ...`
  - 不要用 `powerup property add --type ...`
  - 当前只能创建 plain property，真正的 typed column 需要用户在 RemNote UI 里配置，或改走 plugin-owned powerup schema
- 如果用户要“给列加 option / 删 option”：
  - 先假定目标 property 必须已经是 UI 中存在的 `single_select` / `multi_select`
  - 如果没有明确宿主机本地 DB 支持，就不要承诺成功
  - remote `apiBaseUrl` 模式下这类命令可以直接走 Host API，由宿主机完成校验和执行
  - `apply --payload` 里的 `add_option/remove_option` 也受同样门槛约束，不是绕过路径

## Wait Policy

默认策略：不等待。

只有以下情况加 `--wait` 或单独 `queue wait`：

- 用户明确说“确认写入成功”
- 下一步依赖这次写入已经进入终态
- 需要立即拿到新建 Rem 的真实 ID
- 上一次返回 `sent=0`、`TXN_TIMEOUT`、`TXN_FAILED`

优先级：

1. 业务命令直接带 `--wait`
2. 已有 `txn_id` 时再用 `queue wait`

默认不要因为“写入本来是异步的”就自动等。

## Structure-Sensitive Exception

默认不要为了写入去做额外读取。

但以下任务允许一次轻量 `outline`：

- 扩写当前 Rem
- 把长内容重组为单根大纲
- 校验父子层级是否写对

允许的最小读取：

- 写前一次：确认当前树结构
- 写后一次：确认层级形态

边界：

- 只做 `rem outline`
- 不要升级成 `search`、`inspect`、全文扫描
- 目的只是确认结构，不是做重型验证

## Read Path Priority

只在确实需要读的时候，按这个顺序：

1. `agent-remnote --json plugin current --compact`
2. `agent-remnote --json plugin selection current --compact`
3. `agent-remnote --json plugin ui-context describe`
4. `agent-remnote rem outline --id <remId> --depth 3 --format md`
5. `agent-remnote --json search --query "<keyword>" --limit 10`

目的：

- `plugin current --compact` 适合最低 token 的上下文判断
- `outline` 适合确认树结构
- `search` 适合只知道关键词时做回退

## Plugin Local URL

如果用户是在处理 RemNote Developer URL、本地插件静态服、或“为什么本地插件地址打不开”，优先用这组命令：

```bash
agent-remnote plugin ensure
agent-remnote plugin status
agent-remnote plugin logs --lines 50
agent-remnote plugin stop
```

补充裁决：

- 用户只想前台跑起来看地址，用 `plugin serve`
- 用户想后台常驻，用 `plugin ensure`
- 用户想看当前地址、pid、健康状态，用 `plugin status`
- 用户想排查启动失败或 404，用 `plugin logs`
- 用户想关闭后台服务，用 `plugin stop`
- 这组命令当前不属于默认 `stack ensure/status/stop` 编排

## Remote Mode

如果 Agent 不在宿主机，不要碰本地 `remnote.db` / `store.sqlite`。

准备动作只在需要时执行：

```bash
agent-remnote stack ensure --wait-worker --worker-timeout-ms 15000
agent-remnote api status --json
```

推荐一次性配置：

```bash
agent-remnote config set --key apiBaseUrl --value http://host.docker.internal:3000
agent-remnote config validate
```

之后继续用同一套业务命令：

```bash
agent-remnote --api-base-url http://host.docker.internal:3000 rem children append --rem <parentRemId> --markdown -
agent-remnote --api-base-url http://host.docker.internal:3000 daily write --markdown -
agent-remnote --api-base-url http://host.docker.internal:3000 apply --payload @plan.json
```

remote mode 下也保持同样原则：

- 优先一步到位业务命令
- 默认不 wait
- 默认不额外验证

但要把 remote surface 分成三类：

### 1. 已经支持透明 remote 执行

- `plugin current --compact`
- `plugin selection current --compact`
- `plugin ui-context describe`
- `search`
- `rem outline`
- `daily rem-id`
- `rem children append|prepend|replace|clear`
- `daily write`
- `apply`
- `queue wait`
- `table/powerup option add/remove`

说明：

- 这些命令在 `apiBaseUrl` 存在时应优先走 Host API。
- `table/powerup option add/remove` 虽然依赖本地 DB 校验，但这个“本地”指宿主机；调用方仍然可以透明远程调用。

### 2. 当前仍然 host-only，但本质上是未实现成 Host API

- `powerup schema`
- `table record add/update/delete`
- `table show`
- `rem page-id`
- `inspect`
- `by-reference`
- `resolve-ref`
- `query`
- `references`
- `connections`
- `todos list`
- `daily summary`
- `topic summary`

说明：

- 这类命令之所以在 `apiBaseUrl` 模式下 fail fast，主要是因为它们还会在本地读取 RemNote DB 元数据或宿主机状态。
- 这类边界大多属于“还没实现成等价 Host API”，不是宿主能力做不到。
- `powerup` 写命令也不再作为公开主写入面推广；默认结构化数据写入走 `table ...`。

### 3. 当前宿主能力本身就不支持

- `table property set-type`
- `powerup property set-type`
- typed `table property add --type/--options`
- typed `powerup property add --type/--options`
- raw `apply` 里的 `set_property_type`
- raw `apply` 里的 typed `add_property`

说明：

- 这块是 generic property type mutation 的宿主边界。
- 在本地和远端都不支持，不要把它包装成“切回宿主机再试”。

## DN Rule

DN 最容易写错的是 parent。

如果用户说“写到今天这条日记下面”，注意区分：

- `Daily Document` 容器页
- 当天 `YYYY/MM/DD` 那条 Rem

如果需要拿当天条目 Rem ID：

```bash
agent-remnote --ids daily rem-id
```

只有在用户要写到当天条目下的某个具体 section 时，才继续用 `rem children ...`。

## Markdown Input Rules

所有结构化写入优先：

```bash
--markdown -
```

也支持：

- inline：`--markdown $'- a\n  - b'`
- file：`--markdown @./note.md`

默认推荐 `--markdown -`，因为最适合一轮里直接整理内容后落库。

## Markdown Shape Contract

这里约束的不是“能不能解析”，而是“写出来的大纲是否可长期复用”。

- 报告型内容默认只有一个顶层 bullet。
- 顶层 bullet 下再展开二级和三级，不要把多个主题直接并列在页面根下。
- 单个 bullet 应表达一个完整意思，不要把一段论证拆成多个残句 bullet。
- 链接优先用 Markdown 链接语法。
- 粗体、行内代码、引用 token 可以保留 Markdown 富文本。
- 如果一条列表项本意只是普通 Rem 文本，写入后不应保留字面 `- ` 前缀。
- 如果内容不适合大纲化，不要强行改成“一个根下面很多半成品子项”。

## References and Portals

引用优先级：

- `((RID))`
- `{ref:RID}`

不要默认依赖标题引用。

Portal 不是 Reference。

插 Portal 时用：

```bash
agent-remnote --json portal create --parent "<parentRemId>" --target "<targetRemId>"
```

## Failure Routing

### 1. `sent=0`

表示已入队，但当前没有 active worker 立即消费。

默认处理：

```bash
agent-remnote --json daemon status
agent-remnote plugin ensure
agent-remnote plugin status
agent-remnote plugin logs --lines 50
agent-remnote plugin stop
```

只有在用户要求确认时，再继续：

```bash
agent-remnote daemon sync
agent-remnote --json queue wait --txn "<txn_id>"
```

### 2. 写到了错误 parent

先修 parent，再重写。

不要在错误位置上继续 append。

### 3. `daily write --text` 把 Markdown 当字面文本写进去了

删除错误条目，然后改走 `daily write --markdown` 或 `rem children append`。

### 4. `table/powerup option add/remove` 被拒绝

优先判断三件事：

1. 目标 property 是否已经在 UI 中配置成 `single_select` / `multi_select`
2. 宿主机本地 DB 里的 `ft` 是否已经落出来
3. 当前 remote mode 是否真的打到了正确的宿主机 workspace / DB

如果第 1 或第 2 条不成立，不要重试同一条命令，先让用户在 UI 中完成列类型配置。

如果是第 3 条不成立：

- 优先排查当前 Host API 指向的宿主机是否正确
- 再排查 workspace binding 是否已经稳定到目标 DB
- 不要把问题误判成“remote mode 本身不支持 option mutation”

### 5. 用户要求“程序化创建 typed property”

直接说明当前宿主边界：

- generic property 没有公开的 type mutation endpoint
- 当前只能创建 plain property
- typed schema 需要 UI 配置，或改走 plugin-owned powerup schema

## Minimal Command Set

```bash
agent-remnote --json plugin current --compact
agent-remnote --ids daily rem-id
agent-remnote --json rem children append --rem <parentRemId> --markdown -
agent-remnote --json rem children prepend --rem <parentRemId> --markdown -
agent-remnote --json rem children replace --rem <parentRemId> --markdown -
agent-remnote --json rem children clear --rem <parentRemId>
agent-remnote --json daily write --markdown -
agent-remnote --json daily write --text "..."
agent-remnote --json rem set-text --rem <remId> --text "..."
agent-remnote --json rem create --parent "<parentRemId>" --text "..."
agent-remnote --json rem move --rem "<remId>" --parent "<newParentRemId>"
agent-remnote --json rem delete --rem "<remId>"
agent-remnote --json apply --payload @plan.json
agent-remnote --json queue wait --txn "<txn_id>"
agent-remnote --json daemon status
```

刻意不把 `replace markdown` 放进 minimal command set。

原因：它不是默认业务写入路径，而是 advanced/local-only 的块级替换 escape hatch。

## Principle

只要用户意图能被一个业务命令直接表达，就不要升级到两步。

只要用户没有要求同步确认，就不要主动 wait。

只要目标 rem 已知，就不要先查再写。
