# Quickstart：025-write-receipt-id-map

## 目标

验证 agent 可以直接消费 `id_map` 继续后续步骤。

## Rem create

```bash
agent-remnote --json rem create --parent page:Inbox --text "hello" --wait
```

验收点：

- 直接读取 `id_map`
- 不把 `queue inspect` 当默认下一步

## Apply

```bash
agent-remnote --json apply --payload @plan.json --wait
```

验收点：

- 直接读取 `id_map`
- local / remote 语义一致
