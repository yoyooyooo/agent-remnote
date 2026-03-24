import type { ReactRNPlugin } from '@remnote/plugin-sdk';

import { mapOpType } from './ops/mapOpType';
import type { OpDispatch } from './ops/types';

export type OpLockKey = string;

function normalizeId(x: unknown): string {
  return typeof x === 'string' ? x.trim() : '';
}

function getParentIdOfRem(rem: any): string {
  const parent = rem?.parent;
  if (typeof parent === 'string') return parent.trim();
  const parentId = parent?._id;
  if (typeof parentId === 'string') return parentId.trim();
  return '';
}

export class OpLockManager {
  private locked = new Set<OpLockKey>();
  private waiters: Array<{
    keys: readonly OpLockKey[];
    resolve: (release: () => void) => void;
  }> = [];

  acquire(keysInput: readonly OpLockKey[]): Promise<() => void> {
    const keys = Array.from(new Set(keysInput.map((k) => String(k || '').trim()).filter(Boolean))).sort();
    if (keys.length === 0) return Promise.resolve(() => {});

    const tryAcquireNow = (): (() => void) | null => {
      for (const k of keys) if (this.locked.has(k)) return null;
      for (const k of keys) this.locked.add(k);
      return () => {
        for (const k of keys) this.locked.delete(k);
        this.drain();
      };
    };

    const release = tryAcquireNow();
    if (release) return Promise.resolve(release);

    return new Promise((resolve) => {
      this.waiters.push({ keys, resolve });
      this.drain();
    });
  }

  private drain() {
    if (this.waiters.length === 0) return;

    // Preserve ordering for conflicting ops: a waiter can bypass earlier waiters only if
    // it shares no lock keys with any earlier waiter still waiting.
    const queuedKeys = new Set<OpLockKey>();

    for (let i = 0; i < this.waiters.length; i += 1) {
      const w = this.waiters[i]!;
      const hasConflictWithEarlier = w.keys.some((k) => queuedKeys.has(k));
      const allFree = w.keys.every((k) => !this.locked.has(k));

      if (!hasConflictWithEarlier && allFree) {
        for (const k of w.keys) this.locked.add(k);
        this.waiters.splice(i, 1);
        i -= 1;
        w.resolve(() => {
          for (const k of w.keys) this.locked.delete(k);
          this.drain();
        });
        continue;
      }

      for (const k of w.keys) queuedKeys.add(k);
    }
  }
}

function lockRem(id: string): OpLockKey {
  return `rem:${id}`;
}

function lockChildren(parentId: string): OpLockKey {
  return `children:${parentId}`;
}

async function findParentId(plugin: ReactRNPlugin, remId: string): Promise<string | undefined> {
  try {
    const rem: any = await plugin.rem.findOne(remId);
    const parentId = rem ? getParentIdOfRem(rem) : '';
    return parentId || undefined;
  } catch {
    return undefined;
  }
}

export async function computeOpLockKeys(plugin: ReactRNPlugin, op: OpDispatch): Promise<readonly OpLockKey[]> {
  const mappedType = mapOpType(op.op_type);
  const payload = op.payload || {};

  const keys: OpLockKey[] = [];
  const add = (k: OpLockKey | undefined) => {
    const kk = String(k || '').trim();
    if (kk) keys.push(kk);
  };
  const addRem = (id: string | undefined) => {
    if (!id) return;
    add(lockRem(id));
  };
  const addChildren = (id: string | undefined) => {
    if (!id) return;
    add(lockChildren(id));
  };

  switch (mappedType) {
    case 'create_rem':
    case 'create_portal':
    case 'create_link_rem':
    case 'create_table':
    case 'create_single_rem_with_markdown':
    case 'create_tree_with_markdown': {
      const parentId = normalizeId(payload.parent_id);
      addRem(parentId);
      addChildren(parentId);
      if (mappedType === 'create_portal') {
        const targetId = normalizeId(payload.target_rem_id ?? payload.rem_id);
        addRem(targetId);
      }
      return keys;
    }

    case 'create_portal_bulk': {
      const parentId = normalizeId(payload.parent_id);
      addRem(parentId);
      addChildren(parentId);
      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const item of items) {
        const targetId = normalizeId((item as any)?.target_rem_id ?? (item as any)?.rem_id);
        addRem(targetId);
      }
      return keys;
    }

    case 'replace_selection_with_markdown': {
      // Replace is always a structure mutation: create new content + move + delete selection.
      const targetIdsRaw = payload?.target?.rem_ids;
      const targetIds: string[] = Array.isArray(targetIdsRaw)
        ? targetIdsRaw.map((x: any) => normalizeId(x)).filter(Boolean)
        : [];
      if (targetIds.length === 0) {
        // current-mode replace depends on live editor selection; serialize conservatively.
        return ['global:replace_selection_with_markdown'];
      }
      for (const id of targetIds) addRem(id);
      const parentId = targetIds.length > 0 ? await findParentId(plugin, targetIds[0]!) : undefined;
      addRem(parentId);
      addChildren(parentId);
      return keys;
    }

    case 'replace_children_with_markdown': {
      const parentId = normalizeId(payload.parent_id);
      if (!parentId) return ['global:replace_children_with_markdown'];
      addRem(parentId);
      addChildren(parentId);
      try {
        const parentRem: any = await plugin.rem.findOne(parentId);
        const childIds = Array.isArray(parentRem?.children)
          ? parentRem.children.filter((value: any) => typeof value === 'string' && value.trim()).map((value: string) => value.trim())
          : [];
        for (const childId of childIds) addRem(childId);
      } catch {}
      return keys;
    }

    case 'update_text':
    case 'add_tag':
    case 'remove_tag':
    case 'set_attribute':
    case 'table_cell_write':
    case 'add_source':
    case 'remove_source':
    case 'set_todo_status':
    case 'set_cell_select':
    case 'set_cell_checkbox':
    case 'set_cell_number':
    case 'set_cell_date': {
      const remId = normalizeId(payload.rem_id);
      addRem(remId);
      return keys;
    }

    case 'add_tag_bulk':
    case 'remove_tag_bulk': {
      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const item of items) {
        const remId = normalizeId((item as any)?.rem_id);
        addRem(remId);
      }
      return keys;
    }

    case 'set_todo_status_bulk': {
      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const item of items) {
        const remId = normalizeId((item as any)?.rem_id);
        addRem(remId);
      }
      return keys;
    }

    case 'add_source_bulk':
    case 'remove_source_bulk': {
      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const item of items) {
        const remId = normalizeId((item as any)?.rem_id);
        addRem(remId);
      }
      return keys;
    }

    case 'set_table_filter': {
      const tableId = normalizeId(payload.table_id);
      addRem(tableId);
      return keys;
    }

    case 'add_property': {
      const tagId = normalizeId(payload.tag_id);
      addRem(tagId);
      addChildren(tagId);
      return keys;
    }

    case 'set_property_type': {
      const propertyId = normalizeId(payload.property_id);
      addRem(propertyId);
      return keys;
    }

    case 'add_option': {
      const propertyId = normalizeId(payload.property_id);
      addRem(propertyId);
      addChildren(propertyId);
      return keys;
    }

    case 'remove_option': {
      const optionId = normalizeId(payload.option_id);
      addRem(optionId);
      return keys;
    }

    case 'table_add_row': {
      const rowId = normalizeId(payload.rem_id);
      if (rowId) {
        addRem(rowId);
        return keys;
      }
      const parentId = normalizeId(payload.parent_id);
      addRem(parentId);
      addChildren(parentId);
      return keys;
    }

    case 'table_remove_row': {
      const rowId = normalizeId(payload.rem_id);
      addRem(rowId);
      return keys;
    }

    case 'move_rem': {
      const remId = normalizeId(payload.rem_id);
      const newParentId = normalizeId(payload.new_parent_id);
      addRem(remId);
      addRem(newParentId);
      addChildren(newParentId);
      const oldParentId = remId ? await findParentId(plugin, remId) : undefined;
      addRem(oldParentId);
      addChildren(oldParentId);
      return keys;
    }

    case 'move_rem_bulk': {
      const remIds = Array.isArray(payload.rem_ids)
        ? payload.rem_ids
            .map((value: unknown) => normalizeId(value))
            .filter((value: string) => value.length > 0)
        : [];
      const newParentId = normalizeId(payload.new_parent_id);

      for (const remId of remIds) addRem(remId);
      addRem(newParentId);
      addChildren(newParentId);

      for (const remId of remIds) {
        const oldParentId = remId ? await findParentId(plugin, remId) : undefined;
        addRem(oldParentId);
        addChildren(oldParentId);
      }

      return keys;
    }

    case 'delete_rem':
    case 'delete_backup_artifact': {
      const remId = normalizeId(payload.rem_id);
      addRem(remId);
      const parentId = remId ? await findParentId(plugin, remId) : undefined;
      addRem(parentId);
      addChildren(parentId);
      return keys;
    }

    case 'daily_note_write': {
      // Conservative: serialize all daily-note writes (avoids fighting over the daily doc order).
      return ['global:daily_note_write'];
    }

    default: {
      // Unknown op_type => be conservative.
      return ['global:unknown_op'];
    }
  }
}
