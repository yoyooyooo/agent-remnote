import { canonicalizeOpType } from '../op-catalog/normalize.js';

export type ConflictKey = string;

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

function getFirstString(payload: any, keys: readonly string[]): string | null {
  if (!payload || typeof payload !== 'object') return null;
  for (const k of keys) {
    const v = (payload as any)[k];
    const s = asNonEmptyString(v);
    if (s) return s;
  }
  return null;
}

function getFirstStringFromNested(payload: any, path: readonly string[]): string | null {
  let cur: any = payload;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return null;
    cur = (cur as any)[k];
  }
  return asNonEmptyString(cur);
}

function getStringArrayFromNested(payload: any, path: readonly string[]): readonly string[] {
  let cur: any = payload;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return [];
    cur = (cur as any)[k];
  }
  if (!Array.isArray(cur)) return [];
  const out: string[] = [];
  for (const v of cur) {
    const s = asNonEmptyString(v);
    if (s) out.push(s);
  }
  return out;
}

function uniq(keys: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const k of keys) {
    if (!k) continue;
    if (out.includes(k)) continue;
    out.push(k);
  }
  return out;
}

function isCreateOp(opType: string): boolean {
  return (
    opType.startsWith('create_') ||
    opType === 'create_tree_with_markdown' ||
    opType === 'create_single_rem_with_markdown' ||
    opType === 'create_link_rem'
  );
}

function isStructureOp(opType: string): boolean {
  return opType === 'move_rem' || opType === 'delete_rem' || opType === 'replace_selection_with_markdown';
}

export function deriveConflictKeys(opTypeRaw: unknown, payload: unknown): readonly ConflictKey[] {
  const opType = canonicalizeOpType(opTypeRaw);
  const p: any = payload && typeof payload === 'object' ? payload : null;

  const keys: string[] = [];

  if (opType === 'daily_note_write') {
    keys.push('global:daily_note_write');
    return keys;
  }

  const remId = getFirstString(p, ['rem_id', 'remId']);
  const parentId = getFirstString(p, ['parent_id', 'parentId']);
  const newParentId = getFirstString(p, ['new_parent_id', 'newParentId']);
  const toParentId = getFirstString(p, ['to_parent_id', 'toParentId', 'target_parent_id', 'targetParentId']);
  const fromParentId = getFirstString(p, ['from_parent_id', 'fromParentId']);

  if (opType === 'create_portal') {
    const pid = parentId ?? toParentId;
    if (pid) {
      keys.push(`rem:${pid}`);
      keys.push(`children:${pid}`);
    } else {
      keys.push('global:structure_unknown');
    }
    const targetId = getFirstString(p, ['target_rem_id', 'targetRemId', 'rem_id', 'remId']);
    if (targetId) keys.push(`rem:${targetId}`);
    return uniq(keys);
  }

  if (isCreateOp(opType)) {
    const pid = parentId ?? toParentId;
    if (pid) {
      keys.push(`rem:${pid}`);
      keys.push(`children:${pid}`);
      return uniq(keys);
    }
    keys.push('global:structure_unknown');
    return uniq(keys);
  }

  if (isStructureOp(opType)) {
    if (remId) keys.push(`rem:${remId}`);

    const parents = [parentId, newParentId, toParentId, fromParentId].filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    );
    for (const pid of parents) keys.push(`children:${pid}`);

    if (!remId && parents.length === 0) {
      // Fail-safe: structural ops without enough context become globally exclusive.
      keys.push('global:structure_unknown');
    }

    // Special-case: replace selection includes an explicit target list.
    if (opType === 'replace_selection_with_markdown') {
      const ids = getStringArrayFromNested(p, ['target', 'rem_ids']);
      for (const id of ids) keys.push(`rem:${id}`);
      const ids2 = getStringArrayFromNested(p, ['target', 'remIds']);
      for (const id of ids2) keys.push(`rem:${id}`);
      const mode = getFirstStringFromNested(p, ['target', 'mode']);
      if (mode === 'explicit') {
        const explicitIds = getStringArrayFromNested(p, ['target', 'remIds']);
        for (const id of explicitIds) keys.push(`rem:${id}`);
      }
    }

    return uniq(keys);
  }

  // Default: treat as a rem-scoped write when possible.
  if (remId) keys.push(`rem:${remId}`);
  if (parentId && opType.startsWith('table_')) keys.push(`children:${parentId}`);

  if (keys.length === 0 && parentId) {
    // Conservative fallback for create-like payloads that don't match known opType.
    keys.push(`children:${parentId}`);
  }

  if (keys.length === 0) keys.push('global:unknown');
  return uniq(keys);
}
