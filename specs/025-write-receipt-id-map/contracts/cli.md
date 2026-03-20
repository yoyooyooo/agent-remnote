# CLI Contract：025-write-receipt-id-map

## Canonical Success Receipt

成功 wait-mode 写入结果的 canonical machine contract 是：

```json
{
  "txn_id": "string",
  "status": "succeeded",
  "id_map": []
}
```

## Surface Discipline

- `id_map` 是主机器契约
- wrapper-specific convenience ids 是可选 sugar
- docs 和 Skill 应优先说明如何消费 `id_map`

## Local / Remote Parity

- local `--wait` 与 remote `--wait` 共享同一 `id_map` 语义

## Failure / Timeout Detail

- 如果已有 durable mapping，失败或超时细节必须保留 `id_map`
