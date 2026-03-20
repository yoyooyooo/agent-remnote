# Quickstart：024-agent-first-composite-writes

## 目标

验证 `apply` 已经可以表达 portal atomic action。

## Minimal Example

```json
{
  "version": 1,
  "kind": "actions",
  "actions": [
    {
      "action": "portal.create",
      "input": {
        "parent_id": "id:<parentRemId>",
        "target_rem_id": "id:<targetRemId>"
      }
    }
  ]
}
```

## Dry-Run

```bash
agent-remnote --json apply --payload @portal.json --dry-run
```

验收点：

- 返回编译后的 `create_portal`

## Alias Example

```json
{
  "version": 1,
  "kind": "actions",
  "actions": [
    {
      "as": "anchor",
      "action": "write.bullet",
      "input": {
        "parent_id": "id:<parentRemId>",
        "text": "Anchor"
      }
    },
    {
      "action": "portal.create",
      "input": {
        "parent_id": "@anchor",
        "target_rem_id": "id:<targetRemId>"
      }
    }
  ]
}
```

说明：

- 这里展示的是 atomic composition
- 更高层的场景编排应由 Skill 负责
