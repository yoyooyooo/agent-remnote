# Runtime Mode And Command Parity（SSoT）

## Purpose

This document is the sole authoritative inventory for RemNote-related commands.
It defines:

- which commands are `business`
- which commands are `business_deferred`
- which commands are `operational_host_only`
- the current wave and parity target for each command

`apiBaseUrl` may change transport. For business commands, it must not change
business semantics.

## Authority Model

- This file is the only authoritative command inventory.
- `specs/030-remnote-business-command-mode-parity/contracts/parity-matrix.md`
  is a derived feature-local migration ledger.
- `packages/agent-remnote/src/lib/business-semantics/commandInventory.ts` is a
  derived machine-readable mirror.
- `packages/agent-remnote/src/lib/business-semantics/commandContracts.ts` is a
  Wave 1 executable contract registry derived from this inventory.
- Contract tests must fail on drift between this file and derived artifacts.

## Wave 1 Execution Spine

For `business` commands in `wave1`:

- command inclusion, classification, wave, and parity target are decided here
- executable capability binding may be declared in `commandContracts.ts`
- mode switching may only occur inside the Wave 1 runtime spine:
  - `modeParityRuntime.ts`
  - `localModeAdapter.ts`
  - `remoteModeAdapter.ts`
- Wave 1 business command files must remain thin adapters for argv parsing and
  output formatting
- Wave 1 business command files must not become independent mode authorities

## Parity Contract

For `business` or `business_deferred` commands:

- command shape must stay stable
- parameter semantics must stay stable
- validation rules must stay stable
- success envelope and receipt semantics must stay stable
- stable failure contract must stay stable

Allowed differences:

- reachability
- timeout / retry
- service-start diagnostics

## Authoritative Inventory Data

<!-- COMMAND_INVENTORY:START -->
```json
{
  "commands": [
    { "id": "search", "family": "search_outline", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.outline", "family": "search_outline", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "daily.rem-id", "family": "search_outline", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "page-id", "family": "ref_reads", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "by-reference", "family": "ref_reads", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "references", "family": "ref_reads", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "resolve-ref", "family": "ref_reads", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "query", "family": "ref_reads", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "plugin.current", "family": "ui_context", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "plugin.search", "family": "ui_context", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "plugin.ui-context.snapshot", "family": "ui_context", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "plugin.ui-context.page", "family": "ui_context", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "plugin.ui-context.focused-rem", "family": "ui_context", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "plugin.ui-context.describe", "family": "ui_context", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "plugin.selection.current", "family": "selection_context", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "plugin.selection.snapshot", "family": "selection_context", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "plugin.selection.roots", "family": "selection_context", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "plugin.selection.outline", "family": "selection_context", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "daily.write", "family": "core_writes", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "apply", "family": "core_writes", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "queue.wait", "family": "core_writes", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.create", "family": "rem_graph_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.move", "family": "rem_graph_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "portal.create", "family": "relation_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.replace", "family": "rem_graph_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.children.append", "family": "rem_graph_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.children.prepend", "family": "rem_graph_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.children.clear", "family": "rem_graph_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.children.replace", "family": "rem_graph_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.set-text", "family": "rem_graph_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.delete", "family": "rem_graph_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "tag.add", "family": "relation_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "tag.remove", "family": "relation_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.tag.add", "family": "relation_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "rem.tag.remove", "family": "relation_write", "classification": "business", "wave": "wave1", "parityTarget": "same_support" },
    { "id": "table.show", "family": "table_reads", "classification": "business_deferred", "wave": "wave2", "parityTarget": "same_support" },
    { "id": "table.create", "family": "table_writes", "classification": "business_deferred", "wave": "wave2", "parityTarget": "same_support" },
    { "id": "table.property.add", "family": "table_writes", "classification": "business_deferred", "wave": "wave2", "parityTarget": "same_stable_failure" },
    { "id": "table.property.set-type", "family": "table_writes", "classification": "business_deferred", "wave": "wave2", "parityTarget": "same_stable_failure" },
    { "id": "table.option.add", "family": "table_writes", "classification": "business_deferred", "wave": "wave2", "parityTarget": "same_support" },
    { "id": "table.option.remove", "family": "table_writes", "classification": "business_deferred", "wave": "wave2", "parityTarget": "same_support" },
    { "id": "table.record.add", "family": "table_writes", "classification": "business_deferred", "wave": "wave2", "parityTarget": "same_support" },
    { "id": "table.record.update", "family": "table_writes", "classification": "business_deferred", "wave": "wave2", "parityTarget": "same_support" },
    { "id": "table.record.delete", "family": "table_writes", "classification": "business_deferred", "wave": "wave2", "parityTarget": "same_support" },
    { "id": "powerup.list", "family": "powerup_reads", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.resolve", "family": "powerup_reads", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.schema", "family": "powerup_reads", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.apply", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.remove", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.property.add", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_stable_failure" },
    { "id": "powerup.property.set-type", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_stable_failure" },
    { "id": "powerup.option.add", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.option.remove", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.record.add", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.record.update", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.record.delete", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.todo.add", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.todo.done", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.todo.remove", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "powerup.todo.undone", "family": "powerup_writes", "classification": "business_deferred", "wave": "wave3", "parityTarget": "same_support" },
    { "id": "connections", "family": "analytical_reads", "classification": "business_deferred", "wave": "excluded", "parityTarget": "reclassify" },
    { "id": "daily.summary", "family": "analytical_reads", "classification": "business_deferred", "wave": "excluded", "parityTarget": "reclassify" },
    { "id": "topic.summary", "family": "analytical_reads", "classification": "business_deferred", "wave": "excluded", "parityTarget": "reclassify" },
    { "id": "inspect", "family": "analytical_reads", "classification": "business_deferred", "wave": "excluded", "parityTarget": "reclassify" },
    { "id": "todos.list", "family": "analytical_reads", "classification": "business_deferred", "wave": "excluded", "parityTarget": "reclassify" },
    { "id": "api.*", "family": "operational_lifecycle", "classification": "operational_host_only", "wave": "excluded", "parityTarget": "host_only" },
    { "id": "stack.*", "family": "operational_lifecycle", "classification": "operational_host_only", "wave": "excluded", "parityTarget": "host_only" },
    { "id": "daemon.*", "family": "operational_lifecycle", "classification": "operational_host_only", "wave": "excluded", "parityTarget": "host_only" },
    { "id": "backup.*", "family": "operational_lifecycle", "classification": "operational_host_only", "wave": "excluded", "parityTarget": "host_only" },
    { "id": "config.*", "family": "operational_lifecycle", "classification": "operational_host_only", "wave": "excluded", "parityTarget": "host_only" },
    { "id": "doctor.*", "family": "operational_lifecycle", "classification": "operational_host_only", "wave": "excluded", "parityTarget": "host_only" },
    { "id": "queue.inspect", "family": "operational_lifecycle", "classification": "operational_host_only", "wave": "excluded", "parityTarget": "host_only" },
    { "id": "queue.progress", "family": "operational_lifecycle", "classification": "operational_host_only", "wave": "excluded", "parityTarget": "host_only" },
    { "id": "queue.stats", "family": "operational_lifecycle", "classification": "operational_host_only", "wave": "excluded", "parityTarget": "host_only" },
    { "id": "queue.conflicts", "family": "operational_lifecycle", "classification": "operational_host_only", "wave": "excluded", "parityTarget": "host_only" }
  ]
}
```
<!-- COMMAND_INVENTORY:END -->

## Notes

- `business` commands in `wave1` are parity-mandatory in this feature.
- `business_deferred` commands remain in the inventory and require explicit
  follow-up action.
- `operational_host_only` commands are outside the parity contract.
