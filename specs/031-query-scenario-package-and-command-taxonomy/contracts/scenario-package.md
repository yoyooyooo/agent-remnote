# 契约：ScenarioPackageV1

## 目的

`ScenarioPackageV1` 用来定义一个可复用场景，从 selector 一直到 action。

## 标准形状

```json
{
  "id": "dn_recent_todos_to_today_portal",
  "version": 1,
  "meta": {
    "title": "Recent DN todos to today",
    "owner": "builtin",
    "description": "Collect recent DN todos and portal them into today"
  },
  "vars": {
    "source_scope": { "type": "scope", "default": "daily:past-7d" },
    "target_ref": { "type": "ref", "default": "daily:today" }
  },
  "nodes": [
    {
      "id": "recent_todos",
      "kind": "selector",
      "output_slots": ["selection"],
      "selector_kind": "query",
      "input": {
        "query": {
          "version": 2,
          "root": {
            "type": "powerup",
            "powerup": { "by": "id", "value": "<todo-powerup-id>" }
          },
          "scope": {
            "kind": "var",
            "name": "source_scope"
          },
          "shape": {
            "roots_only": true
          }
        }
      }
    },
    {
      "id": "portal_to_today",
      "kind": "action",
      "depends_on": ["recent_todos"],
      "output_slots": ["receipt"],
      "command_id": "portal.create",
      "input": {
        "selection": {
          "kind": "node_output",
          "node": "recent_todos",
          "output": "selection"
        },
        "target_ref": {
          "kind": "var",
          "name": "target_ref"
        }
      }
    }
  ],
  "entry": ["recent_todos"],
  "outputs": ["portal_to_today"],
  "policy": {
    "wait": false,
    "remote_parity_required": true,
    "max_items": 200
  },
  "capabilities": {}
}
```

## 契约规则

- `nodes` 必须形成受约束 DAG
- `meta + vars + nodes + entry + outputs + policy + capabilities` 共同构成 canonical outer shape
- `selector` 节点必须编译到 generic selector model
- `selector` 节点至少声明：
  - `selector_kind`
  - `input`
  - `output_slots`
- `transform` 节点至少声明：
  - `transform_kind`
  - `input`
  - `output_slots`
- `action` 节点必须编译到现有 business-command 语义或 `apply kind=actions`
- `action` 节点至少声明：
  - `command_id`
  - `input`
  - `output_slots`
- 所有边必须显式落在 `depends_on`
- 所有 `StructuredReferenceNode.node_output` 只能引用已声明 output slot
- 节点不得通过拼接式 `kind` 命名引入第二套 action / selector taxonomy
- `vars` 必须在执行前完成校验
- `policy` 不得创造第二套 transport 或 mode switch
- `capabilities` 只声明静态执行前提与可用能力，不声明 transport、endpoint、host-only implementation detail
- builtin 与 skill-owned package 共享同一份 schema
- canonical contract 不得使用自由字符串 DSL
- `transform` 只允许 host-independent selection / projection algebra，不允许读取 live host facts
- `policy.fallback_strategy` 若存在，只能表达 host-independent outcome policy：
  - `fail`
  - `allow_empty_selection`
  - `skip_optional_outputs`
- `capabilities` 只能声明前置能力，如：
  - `requires.powerup_metadata`
  - `requires.ui_context`
  - `requires.write_runtime`
- `capabilities` 不得声明：
  - endpoint
  - port
  - file path
  - local/remote mode
  - transport choice

## 执行语义

1. validate package
2. bind vars
3. resolve DAG and build `ScenarioExecutionPlanV1`
4. execute selector nodes and produce `SelectionSet`
5. execute transform / action planning
6. compile action layer
7. execute through business command semantics or `apply`
