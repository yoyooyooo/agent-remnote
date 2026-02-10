# Contract: Write Plan Schema（v1）

> 用户可见错误/提示必须英文；本文件的示例消息也用英文。

## Payload

### Root

```json
{
  "version": 1,
  "steps": [
    {
      "as": "topic",
      "action": "write.md.single",
      "input": {
        "parent_id": "daily:today",
        "markdown": "..."
      }
    }
  ]
}
```

### Rules

- `version` MUST be `1` (fail-fast otherwise).
- `steps[]` MUST be non-empty.
- `as` (when provided) MUST be unique within the plan and match the chosen alias regex: `^[A-Za-z][A-Za-z0-9_-]{0,63}$`.
- `@alias` MUST reference an existing `as`.
- `@alias` MAY only appear in ID semantic fields:
  - action-specific allowlist (see Actions table below)
  - default allowlist keys: `*_id`, `*_ids` (excluding `client_temp_id` / `client_temp_ids`)

## Temp IDs & Alias Map

- Compiler generates **client temp ids** in the form: `tmp:<uuid>` (opaque string).
- For each step with `as`, compiler adds a mapping: `alias_map[as] = <tempId>`.
- For actions that support `as`, compiler injects the temp id into the generated op payload (e.g. `client_temp_id`).
- Downstream, daemon persists `id_map(client_temp_id -> remote_id)` based on plugin ack, then performs **dispatch-time substitution** in later ops.

## Actions (v1)

> v1 优先覆盖“多步依赖写入”所需的最小 action set；table/tag 扩展可后续纳入（或通过 raw ops action 承载）。

### Action Table

| Action | Compiles To (op.type) | Supports `as` | ID fields allowlist (`@alias` allowed) |
|---|---|---:|---|
| `write.bullet` | `create_rem` | yes | `input.parent_id` |
| `write.md` | `create_tree_with_markdown` | no | `input.parent_id` |
| `write.md.single` | `create_single_rem_with_markdown` | yes | `input.parent_id` |
| `daily.write` | `daily_note_write` | no | *(none)* |
| `rem.updateText` | `update_text` | no | `input.rem_id` |
| `replace.block` | `replace_selection_with_markdown` | no | `input.target.rem_ids[]`, `input.portal_id` |
| `tag.add` | `add_tag` | no | `input.rem_id`, `input.tag_id` |

### Action Inputs (v1)

#### `write.bullet`

- `input.parent_id: string` (required; supports `@alias`)
- `input.text: string` (required)
- optional: `input.is_document: boolean`, `input.tags: string[]` *(raw plugin feature; should be used sparingly)*

Compiler will inject: `payload.client_temp_id = alias_map[as]` when `as` is present.

#### `write.md`

- `input.parent_id: string` (required; supports `@alias`)
- `input.markdown: string` (required)
- optional: `input.indent_mode: boolean`, `input.indent_size: number`, `input.parse_mode: 'raw' | 'ast' | 'prepared'`
- optional: `input.bundle: { enabled: true, title?: string, summary?: string }`
- optional: `input.position: number`

#### `write.md.single`

- `input.parent_id: string` (required; supports `@alias`)
- `input.markdown: string` (required)

Compiler will inject: `payload.client_temp_id = alias_map[as]` when `as` is present.

#### `daily.write`

- `input.text?: string`
- `input.markdown?: string`
- `input.date?: string | number` (ISO string or timestamp)
- `input.offset_days?: number`
- `input.prepend?: boolean`
- optional: `input.bundle: { enabled: true, title?: string, summary?: string }`
- optional: `input.position?: number`

#### `rem.updateText`

- `input.rem_id: string` (required; supports `@alias`)
- `input.text: any` (required; rich-text JSON accepted)

#### `replace.block`

- `input.markdown: string` (required)
- `input.target: { mode: 'explicit', rem_ids: string[] }` (required; rem_ids supports `@alias`)
- optional: `input.require_same_parent?: boolean`
- optional: `input.require_contiguous?: boolean`
- optional: `input.portal_id?: string` (supports `@alias`)

#### `tag.add`

- `input.rem_id: string` (required; supports `@alias`)
- `input.tag_id: string` (required; supports `@alias`)

### Notes

- Any `as` used with actions marked `Supports as = no` MUST fail-fast with a stable error code.
- `@alias` inside non-allowlisted fields MUST fail-fast to avoid accidental substitution in `markdown/text`.
