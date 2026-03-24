import { describe, expect, it, vi } from 'vitest';

import { computeOpLockKeys } from '../src/bridge/opConcurrency.ts';

describe('plugin op concurrency', () => {
  it('derives bulk move lock keys without falling back to global unknown', async () => {
    const plugin = {
      rem: {
        findOne: vi.fn(async (id) => {
          const parentById = {
            r1: { _id: 'r1', parent: 'old-parent-1' },
            r2: { _id: 'r2', parent: 'old-parent-2' },
          };
          return parentById[id] ?? null;
        }),
      },
    };

    const keys = await computeOpLockKeys(plugin, {
      op_type: 'move_rem_bulk',
      payload: {
        rem_ids: ['r1', 'r2'],
        new_parent_id: 'new-parent',
      },
    });

    expect([...keys].sort()).toEqual([
      'children:new-parent',
      'children:old-parent-1',
      'children:old-parent-2',
      'rem:new-parent',
      'rem:old-parent-1',
      'rem:old-parent-2',
      'rem:r1',
      'rem:r2',
    ].sort());
  });

  it('derives bulk portal lock keys for the shared parent and all targets', async () => {
    const plugin = { rem: {} };

    const keys = await computeOpLockKeys(plugin, {
      op_type: 'create_portal_bulk',
      payload: {
        parent_id: 'parent-1',
        items: [{ target_rem_id: 'r1' }, { target_rem_id: 'r2' }],
      },
    });

    expect([...keys].sort()).toEqual([
      'children:parent-1',
      'rem:parent-1',
      'rem:r1',
      'rem:r2',
    ]);
  });

  it('derives bulk tag lock keys from all target rems', async () => {
    const plugin = { rem: {} };

    const keys = await computeOpLockKeys(plugin, {
      op_type: 'add_tag_bulk',
      payload: {
        items: [
          { rem_id: 'r1', tag_id: 't1' },
          { rem_id: 'r2', tag_id: 't1' },
        ],
      },
    });

    expect([...keys].sort()).toEqual(['rem:r1', 'rem:r2']);
  });

  it('derives bulk source lock keys from all target rems', async () => {
    const plugin = { rem: {} };

    const keys = await computeOpLockKeys(plugin, {
      op_type: 'add_source_bulk',
      payload: {
        items: [
          { rem_id: 'r1', source_id: 's1' },
          { rem_id: 'r2', source_id: 's1' },
        ],
      },
    });

    expect([...keys].sort()).toEqual(['rem:r1', 'rem:r2']);
  });
});
