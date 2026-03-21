# Command Surface: 029-write-command-surface-reset

## 目标

把 `rem create` / `rem move` / `portal create` 和相关 Rem graph 写命令拉到同一水平线，形成稳定、可教学、可路由的 Agent-facing primitive 心智模型。

## 一句话心智

- `rem create`：创建一个新 subject
- `rem move`：移动一个已有 subject
- `portal create`：在某个位置插入一个指向某个目标对象的 portal

所有相关命令都围绕五个问题展开：

1. **subject 是谁**
2. **from 从哪来**
3. **to 指向谁**
4. **at 放到哪 / 插到哪**
5. **portal 要不要顺带补**

不是每条命令都需要五个轴，但这些轴的词义必须稳定。

## 参数轴

| Axis | Meaning | Typical Commands |
| --- | --- | --- |
| `subject` | acted-on object | `rem move`, `rem set-text`, `rem delete`, `rem children *` |
| `from` | create input source | `rem create` |
| `to` | relation target object | `portal create`, `tag add/remove`, future relation-oriented commands |
| `at` | spatial placement | `rem create`, `rem move`, `portal create` |
| `portal` | optional portal strategy | `rem create`, `rem move` |

## 命令家族

### 1. Subject Mutation Primitive

- `rem set-text`
- `rem delete`
- `rem children append/prepend/clear/replace`
- `rem replace`

### 2. Subject Relocation / Composition Primitive

- `rem create`
- `rem move`

### 3. Relation Insertion Primitive

- `portal create`
- `tag add`
- `tag remove`

硬路由：

- 只想插一个 portal，不创建新 subject，不移动旧 subject：用 `portal create`
- 只想增删 tag-rem 关系边：用 `tag add/remove`
- 想创建新 subject，并顺带留下 portal：用 `rem create`
- 想移动已有 subject，并顺带留下 portal：用 `rem move`

## 未来命令长相

### `rem create`

```bash
agent-remnote rem create \
  (--text <text> | --markdown <input> | --from <ref>... | --from-selection) \
  --at <placement-spec> \
  [--title <text>] \
  [--portal <portal-strategy>] \
  [--is-document]
```

读法：

- source 是什么
- 新 subject 放到哪
- 是否顺带补 portal，补在哪

### `rem move`

```bash
agent-remnote rem move \
  --subject <ref> \
  --at <placement-spec> \
  [--portal <portal-strategy>] \
  [--is-document]
```

读法：

- 主体是谁
- 挪到哪
- 是否原位或异位留 portal

### `portal create`

```bash
agent-remnote portal create \
  --to <ref> \
  --at <placement-spec>
```

读法：

- portal 指向谁
- portal 本身插在哪

### `tag add`

```bash
agent-remnote tag add \
  --tag <ref>... \
  --to <ref>...
```

读法：

- 哪些 tag
- 关联到哪些 Rem
- 实际关系边按 `tags × to` 展开

例子：

```bash
agent-remnote tag add \
  --tag id:t1 \
  --tag id:t2 \
  --to id:r1 \
  --to id:r2
```

这条命令会写出 4 条关系边：

- `t1 -> r1`
- `t1 -> r2`
- `t2 -> r1`
- `t2 -> r2`

注意：

- 这不是一一配对语义
- 如果调用方心里想的是 zip / pairwise，应该拆成多次调用，或改走 `apply --payload`

## `in-place` 为什么是 portal strategy 的取值

`in-place` 的含义是“portal 放回原位置”。

例子：

```bash
agent-remnote rem move \
  --subject id:r1 \
  --at standalone \
  --portal in-place
```

含义：

- 把 `r1` 移成 standalone
- 在 `r1` 原来的位置补一个 portal

例子：

```bash
agent-remnote rem create \
  --from-selection \
  --title "Bundle" \
  --at standalone \
  --portal in-place
```

含义：

- 把当前 selection 抽成新 subject
- 在原 selection range 起点补一个 portal

显式 repeated `--from` 也一样，只要这些 refs 解析到同一 parent 下的一个 contiguous range：

```bash
agent-remnote rem create \
  --from id:r1 \
  --from id:r2 \
  --title "Bundle" \
  --at standalone \
  --portal in-place
```

规则补充：

- 这些 refs 必须解析到同一个 parent
- contiguous 判定基于本地 hierarchy metadata 的 direct-sibling order
- 最终 move 顺序与 destination child 顺序按原 sibling order 归一化，而不是按 CLI 传参顺序
- 这是一条 advanced path，默认心智优先用 `--from-selection --portal in-place`
- 只有上游已经持有稳定 rem ids，或明确不想依赖 UI selection 时，再走 repeated `--from ... --portal in-place`

## Why `subject` / `from` / `to` / `at` Must All Exist

这些概念不能合并。

例子：

```bash
agent-remnote rem create \
  --from id:r1 \
  --from id:r2 \
  --title "Bundle" \
  --at standalone
```

这里：

- `from` 回答“输入对象是谁”
- `at` 回答“新 subject 放到哪”

如果把两者压成一个参数，会丢掉“多输入单输出”的清晰性。

例子：

```bash
agent-remnote portal create \
  --to id:r1 \
  --at after:id:r2
```

这里：

- `to` 回答“portal 指向谁”
- `at` 回答“portal 插在哪”

如果 `to` 同时表示位置，`portal create` 会立刻变糊。

## `portal at:<placement-spec>` 的限制

- `--portal at:standalone` 非法
- portal strategy 里的 `at:...` 只接受真正能把 portal 放进树里的位置
- 如果你看到 `standalone`，那是 subject placement，不是 portal placement

## 标题与正文规则

### `--markdown`

- 必须显式 `--title`

### repeated `--from`

- 单个 `--from` 可沿用 source Rem 文本作为 title
- 多个 `--from` 必须显式 `--title`
- source Rem 会被 move 到新 destination 下

### `--from-selection`

- 单 root 可沿用选中 root 文本作为 title
- 多 root 必须显式 `--title`

### `--text`

- 无 `--title`：text 本身就是 destination title
- 有 `--title`：title 是 destination title，text 写成第一条 body child

## Breaking Change Matrix

| Old | New |
| --- | --- |
| `rem move --rem` | `rem move --subject` |
| `rem create --target` | `rem create --from` |
| `portal create --target` | `portal create --to` |
| `--parent/--before/--after/--standalone` | `--at <placement-spec>` |
| `--portal-parent/--portal-before/--portal-after` | `--portal at:<placement-spec>` |
| `--leave-portal` | `--portal in-place` on `rem move` |
| `--leave-portal-in-place` | `--portal in-place` on `rem create --from-selection` |
| write-command-level `--ref` | removed; ref stays in value syntax |
| `--rem` on single-subject write commands | `--subject` |
| `tag add/remove --subject` | `tag add/remove --tag ... --to ...` |

## 命令等高后的收益

- 帮助文档更短
- examples 可以复用
- Agent routing 可以先看轴，再选命令
- SSoT 与 skill 不再需要记忆历史别名
- `028` 里的 planner 语义可以继续复用

## 明确不做的事

- 不把 `portal create` 提升成组合业务命令
- 不在本轮统一 read surface
- 不做兼容 alias
