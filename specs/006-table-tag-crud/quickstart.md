# Quickstart: Table / Tag CRUD (Agent-Friendly)

前提：
- RemNote Desktop 已打开，插件已安装并连接 WS bridge
- 当你依赖 `daily:today` 或日期列写入时，请先在 RemNote 打开对应日期的 Daily Notes（否则会报错）

## Read a Table (Tag)

```bash
agent-remnote read table --id <tableTagId> --include-options
```

## Add a Record (creates a Rem + tags it)

```bash
agent-remnote write table record add --table-tag <tableTagId> --parent <parentRemId> --text "Idea" --values '[{"propertyName":"Status","value":"Todo"}]'
```

No location provided → fallback to `daily:today`:

```bash
agent-remnote write table record add --table-tag <tableTagId> --text "Quick capture"
```

## Update a Record

```bash
agent-remnote write table record update --table-tag <tableTagId> --row <rowRemId> --values '[{"propertyId":"<propertyId>","value":"Done"}]'
```

## Delete a Record (deletes the Rem)

```bash
agent-remnote write table record delete --table-tag <tableTagId> --row <rowRemId>
```

## Tag a Rem (add/remove)

```bash
agent-remnote write tag add --rem <remId> --tag <tagId>
agent-remnote write tag remove --rem <remId> --tag <tagId>
```

## Manage Properties (Columns)

```bash
agent-remnote write table property add --table-tag <tableTagId> --name "Status" --type "select" --options '["Todo","Done"]'
agent-remnote write table option add --property <propertyId> --text "Blocked"
```

