import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import { mapOpType } from './mapOpType';
import type { OpDispatch } from './types';

import { executeDailyNoteWrite } from './handlers/dailyNoteWrite';
import {
  executeCreateSingleRemWithMarkdown,
  executeCreateTreeWithMarkdown,
  executeReplaceSelectionWithMarkdown,
} from './handlers/markdownOps';
import {
  executeCreateLinkRem,
  executeCreateRem,
  executeDeleteRem,
  executeMoveRem,
  executeUpdateText,
} from './handlers/remCrudOps';
import { executeCreatePortal } from './handlers/portalOps';
import {
  executeAddOption,
  executeAddProperty,
  executeCreateTable,
  executeRemoveOption,
  executeSetCellCheckbox,
  executeSetCellDate,
  executeSetCellNumber,
  executeSetCellSelect,
  executeSetPropertyType,
  executeSetTableFilter,
  executeTableAddRow,
  executeTableRemoveRow,
} from './handlers/tableOps';
import {
  executeAddSource,
  executeAddTag,
  executeRemoveSource,
  executeRemoveTag,
  executeSetAttributeOrTableCellWrite,
  executeSetTodoStatus,
} from './handlers/metaOps';

const seenIdempotency = new Set<string>();
const inFlightIdempotency = new Set<string>();
const idempotencyResultByKey = new Map<string, any>();

function markIdempotency(op: OpDispatch, result: any) {
  if (!op.idempotency_key) return;
  if (result && result.ok) {
    seenIdempotency.add(op.idempotency_key);
    idempotencyResultByKey.set(op.idempotency_key, result);
  }
}

export async function executeOp(plugin: ReactRNPlugin, op: OpDispatch): Promise<any> {
  const idem = op.idempotency_key ? String(op.idempotency_key) : '';
  try {
    if (idem && seenIdempotency.has(idem)) {
      const cached = idempotencyResultByKey.get(idem);
      if (cached && typeof cached === 'object') return { ...cached, dedup: true };
      return { ok: true, dedup: true };
    }
    if (idem && inFlightIdempotency.has(idem)) {
      return { ok: false, fatal: false, error: 'idempotency_key is in-flight; retry later' };
    }
    if (idem) inFlightIdempotency.add(idem);
    const mappedType = mapOpType(op.op_type);
    let result: any;
    switch (mappedType) {
      case 'daily_note_write':
        result = await executeDailyNoteWrite(plugin, op);
        break;
      case 'create_rem':
        result = await executeCreateRem(plugin, op);
        break;
      case 'create_portal':
        result = await executeCreatePortal(plugin, op);
        break;
      case 'create_single_rem_with_markdown':
        result = await executeCreateSingleRemWithMarkdown(plugin, op);
        break;
      case 'create_tree_with_markdown':
        result = await executeCreateTreeWithMarkdown(plugin, op);
        break;
      case 'replace_selection_with_markdown':
        result = await executeReplaceSelectionWithMarkdown(plugin, op);
        break;
      case 'create_link_rem':
        result = await executeCreateLinkRem(plugin, op);
        break;
      case 'create_table':
        result = await executeCreateTable(plugin, op);
        break;
      case 'add_property':
        result = await executeAddProperty(plugin, op);
        break;
      case 'set_property_type':
        result = await executeSetPropertyType(plugin, op);
        break;
      case 'set_table_filter':
        result = await executeSetTableFilter(plugin, op);
        break;
      case 'add_option':
        result = await executeAddOption(plugin, op);
        break;
      case 'remove_option':
        result = await executeRemoveOption(plugin, op);
        break;
      case 'table_add_row':
        result = await executeTableAddRow(plugin, op);
        break;
      case 'table_remove_row':
        result = await executeTableRemoveRow(plugin, op);
        break;
      case 'set_cell_select':
        result = await executeSetCellSelect(plugin, op);
        break;
      case 'set_cell_checkbox':
        result = await executeSetCellCheckbox(plugin, op);
        break;
      case 'set_cell_number':
        result = await executeSetCellNumber(plugin, op);
        break;
      case 'set_cell_date':
        result = await executeSetCellDate(plugin, op);
        break;
      case 'update_text':
        result = await executeUpdateText(plugin, op);
        break;
      case 'move_rem':
        result = await executeMoveRem(plugin, op);
        break;
      case 'add_tag':
        result = await executeAddTag(plugin, op);
        break;
      case 'remove_tag':
        result = await executeRemoveTag(plugin, op);
        break;
      case 'set_attribute':
      case 'table_cell_write':
        result = await executeSetAttributeOrTableCellWrite(plugin, op);
        break;
      case 'add_source':
        result = await executeAddSource(plugin, op);
        break;
      case 'remove_source':
        result = await executeRemoveSource(plugin, op);
        break;
      case 'set_todo_status':
        result = await executeSetTodoStatus(plugin, op);
        break;
      case 'delete_rem':
        result = await executeDeleteRem(plugin, op);
        break;
      default:
        // Unknown op_type => fatal error to avoid endless retry loops.
        result = { ok: false, error: `unknown op_type: ${op.op_type}`, fatal: true };
        break;
    }
    markIdempotency(op, result);
    return result;
  } catch (e) {
    const msg = String((e as any)?.message || e);
    await plugin.app.toast(`Execution failed: ${msg}`);
    return { ok: false, error: msg, fatal: true };
  } finally {
    if (idem) inFlightIdempotency.delete(idem);
  }
}
