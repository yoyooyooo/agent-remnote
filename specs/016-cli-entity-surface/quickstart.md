# Quickstart: 016-cli-entity-surface (manual verification)

> 适用于实现完成后的“最短手工验收”；示例中所有输出消息均应为英文。

## 0) Preconditions

- RemNote Desktop 已打开且插件在线（WS bridge 有 active worker）
- queue DB 使用默认或显式 `--queue-db` 指向同一份库

## 1) Sanity

```bash
agent-remnote --json doctor
agent-remnote --json daemon status
agent-remnote --json read ui-context snapshot
```

## 2) Portal

```bash
# parent: 当前页面 / 目标页面
PRID="$(agent-remnote --ids read ui-context page)"
agent-remnote --json write portal create --parent "$PRID" --target "remnote://w/<kbId>/<remId>" --wait --timeout-ms 60000
```

## 3) Tag (two surfaces; must be identical)

```bash
RID="<remId>"
TAG="<tagId>"

agent-remnote --json write tag add --rem "$RID" --tag "$TAG" --wait
agent-remnote --json write rem tag add --rem "$RID" --tag "$TAG" --wait
```

## 4) Table (create + record)

```bash
PRID="$(agent-remnote --ids read ui-context page)"
TABLE_TAG="<tableTagId>"

agent-remnote --json write table create --table-tag "$TABLE_TAG" --parent "$PRID" --wait
agent-remnote --json write table record add --table-tag "$TABLE_TAG" --parent "$PRID" --text "Idea" --wait
```
