# agent-remnote 写入输入面矩阵（SSoT）

本文件定义写入命令的参数输入面，回答三个问题：

1. 哪些参数是标量 ref / placement / strategy
2. 哪些参数是富内容输入，支持 input-spec / `@file` / `-`
3. 什么时候应直接升级到 `apply --payload`

## 统一轴

- `subject`：单主体写命令的直接作用对象
- `from`：`rem create` 的 source
- `to`：关系目标
- `at`：空间位置
- `portal`：portal 策略

## 参数类型矩阵

| Parameter | Kind | Supports input-spec | Supports `@file` | Supports `-` | Notes |
| --- | --- | --- | --- | --- | --- |
| `--subject` | scalar ref value | no | no | no | 接受 `id:` / `page:` / `title:` / `daily:` / deep link |
| repeated `--from` | scalar ref value list | no | no | no | 多个 source 时按源 sibling 顺序归一化 |
| `--from-selection` | boolean source selector | no | no | no | 不能与其它 source mode 混用 |
| `--to` | scalar ref value | no | no | no | 当前用于 `portal create` |
| `--at` | scalar placement spec | no | no | no | `standalone` / `parent:<ref>` / `parent[n]:<ref>` / `before:<ref>` / `after:<ref>` |
| `--portal` | scalar portal strategy | no | no | no | `in-place` 或 `at:<placement-spec>` |
| `--title` | scalar text | no | no | no | 仅标题，不承载富内容 |
| `--text` | scalar text body | no | no | no | 字面文本；看起来像结构化 Markdown 时默认 fail-fast |
| `--markdown` | rich content | yes | yes | yes | 与其它富内容参数同轮只建议保留一个 stdin-backed 参数 |
| `--meta` | JSON input-spec | yes | yes | yes | 语义上是 metadata，不是正文 |
| `--payload` | JSON / apply envelope | yes | yes | yes | 仅 `apply` 使用 |

## 命令输入面

### `rem create`

- source：
  - `--text <text>`
  - `--markdown <input-spec>`
  - repeated `--from <ref>`
  - `--from-selection`
- placement：
  - `--at <placement-spec>`
- portal：
  - `--portal in-place | at:<placement-spec>`

规则：

- 四种 source mode 必须四选一
- `--markdown` requires `--title`
- 多个 `--from` requires `--title`
- `--portal in-place` 只允许 `--from-selection` 或满足 contiguous sibling range 的 repeated `--from`

### `rem move`

- `--subject <ref>`
- `--at <placement-spec>`
- `[--portal in-place | at:<placement-spec>]`

### `portal create`

- `--to <ref>`
- `--at <placement-spec>`

限制：

- `portal create --at standalone` 非法
- `--portal at:standalone` 对所有命令都非法

### 单主体写命令

- `rem set-text --subject <ref> --text <text>`
- `rem delete --subject <ref>`
- `rem children append|prepend|clear --subject <ref> ...`
- `rem children replace --subject <ref> ...`
- `rem replace --subject <ref>... --surface ...`
- repeated `tag add|remove --tag <ref>... --to <ref>...`

## stdin 约束

- 一次命令最多应有一个 stdin-backed 参数
- 当前主要是 `--markdown -`、`--meta -`、`--payload -`
- 若一个写入需求同时包含多段富内容或多块 JSON/Markdown，优先改走 `apply --payload`

## 何时升级到 `apply --payload`

以下场景优先 `apply`：

- 后一步依赖前一步新建的 Rem id
- 同一事务里要组合 `portal.create`、`tag.add`、`rem.children.append` 等多个原子动作
- 一个命令需要多个富内容输入
- 需要显式 `@alias` 传递 durable target / portal target

## heredoc 建议

推荐：

```bash
cat <<'MD' | agent-remnote --json rem children append --subject "page:Inbox" --markdown - --wait
- title
  - point
MD
```

不推荐：

- 在同一轮命令里同时让 `--markdown -` 与 `--payload -` 竞争 stdin
- 用 `--text` 传结构化 Markdown，再依赖 `--force-text` 兜底
