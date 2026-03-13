---
name: remnote
description: 'Use this skill for any RemNote-specific read/write task. Trigger it whenever the user mentions RemNote, Daily Note, 今日笔记, 当前 page/focus/selection, remId, 替换/清空/追加子级, queue/WS/plugin sync, sent=0, powerup/table/property changes, or remote `apiBaseUrl` mode, even if they only say “记到笔记里” or “查一下当前 page”. Prefer the shortest `agent-remnote` business command first, such as `plugin current --compact`, `rem children replace|clear|append|prepend`, `daily write`, `rem outline`, or `daily rem-id`. Only escalate to `apply --payload` for true dependency chains, and only add wait/verify when the user explicitly asks or the next step depends on completion.'
---

# RemNote

## Core Goal

用最短路径完成 RemNote 读写。

优先级固定如下：

1. 能一步完成的业务命令，直接一步完成。
2. 默认只发起写入，不等待消费完成。
3. 默认不做额外读取、不做事前 inspect、不做写后验证。
4. 只有多步依赖或用户明确要求时，才进入 `apply`、`queue wait`、`rem outline` 这类更重路径。

## Hard Rules

- 禁止直接写入 RemNote 官方数据库 `remnote.db`。
- 所有写入必须走 `queue -> WS -> plugin SDK`。
- 结构化内容默认用 Markdown 无序列表，不要把聊天原文直接落库。
- 默认不要加 `--wait`。
- 默认不要在写入前先 `inspect`、`search`、`outline`。
- 用户给了明确 `remId` / `parentRemId` 时，直接写，不要再多查一轮。
- `table/powerup property set-type` 当前不支持，`property add --type/--options` 也不能承诺建出真正的 typed property。
- `table/powerup option add/remove` 只适用于已经在 UI 中存在的 `single_select` / `multi_select` 列；CLI 会先读本地 DB 检查 `ft`。
- `table/powerup option add/remove` 现在可以在 remote `apiBaseUrl` 模式下通过 Host API 透明执行，但校验仍然发生在宿主机的本地 DB 上，不是调用方本地镜像。
- 真正“宿主做不到”的是 generic property type mutation；仍然 host-only 的其它命令大多只是还没铺到 Host API，不要混为一谈。

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
5. 用户只是说“写到今天日记里”：
   用 `daily write`
6. 只有后一步依赖前一步新建结果时：
   用 `apply --payload`

如果一个 prompt 同时匹配多条，优先更强语义：

- `replace` 高于 `append`
- `clear` 高于 `append`
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
- `powerup apply`
- `powerup record add/update/delete`
- `powerup todo add/remove`
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

## Principle

只要用户意图能被一个业务命令直接表达，就不要升级到两步。

只要用户没有要求同步确认，就不要主动 wait。

只要目标 rem 已知，就不要先查再写。
