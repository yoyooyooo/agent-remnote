# CLI Contract：024-agent-first-composite-writes

## Canonical Entry

```bash
agent-remnote --json apply --payload @plan.json
```

说明：

- 依赖前序结果的多步链路继续收敛到 `apply`
- 本特性增加的是一个原子 action，不是一个新 workflow command

## Canonical Portal Action

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

## Input Shape

| Field | Required | Notes |
| --- | --- | --- |
| `input.parent_id` | yes | explicit id or alias |
| `input.target_rem_id` | yes | explicit id or alias |
| `input.position` | no | optional insert position |

## Alias Rules

- alias 只能引用 earlier action
- `parent_id` 与 `target_rem_id` 都允许 alias
- unresolved alias 必须 fail-fast

## Dry-Run Contract

```bash
agent-remnote --json apply --payload @plan.json --dry-run
```

期望：

- 返回 `kind=actions`
- 返回编译后的 `ops`
- `ops` 中包含 `create_portal`

## Remote Contract

local 与 remote `writeApply` 必须接收同一 envelope 形状：

- `POST /v1/write/apply`
- `agent-remnote --api-base-url ... apply --payload @plan.json`

## Surface Discipline

- CLI 只暴露 portal atomic action
- scenario composition 由 Skill 和 action 组合承担
- 本特性不引入 workflow-specific 命令或参数
