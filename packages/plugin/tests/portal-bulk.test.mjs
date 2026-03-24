import { describe, expect, it, vi } from 'vitest';

import { executeCreatePortal, executeCreatePortalBulk } from '../src/bridge/ops/handlers/portalOps.ts';

describe('plugin create_portal_bulk', () => {
  it('keeps scalar create_portal default insertion at append position when no explicit position is provided', async () => {
    const moveRems = vi.fn(async () => {});
    const addToPortal = vi.fn(async () => {});

    const plugin = {
      rem: {
        createPortal: vi.fn(async () => ({
          _id: 'portal-1',
          remove: vi.fn(async () => {}),
        })),
        moveRems,
        findOne: vi.fn(async (id) => ({ _id: id, addToPortal })),
      },
    };

    const result = await executeCreatePortal(plugin, {
      payload: {
        parent_id: 'parent-1',
        target_rem_id: 'r1',
      },
    });

    expect(moveRems).toHaveBeenCalledWith(['portal-1'], 'parent-1', 1_000_000_000);
    expect(addToPortal).toHaveBeenCalledWith('portal-1');
    expect(result).toMatchObject({
      ok: true,
      parent_id: 'parent-1',
      target_rem_id: 'r1',
      portal_id: 'portal-1',
    });
  });

  it('creates multiple portals under one parent and returns per-item results', async () => {
    const moveRems = vi.fn(async () => {});
    const addToPortalR1 = vi.fn(async () => {});
    const addToPortalR2 = vi.fn(async () => {});

    let seq = 0;
    const plugin = {
      rem: {
        createPortal: vi.fn(async () => {
          seq += 1;
          return {
            _id: `portal-${seq}`,
            remove: vi.fn(async () => {}),
          };
        }),
        moveRems,
        findOne: vi.fn(async (id) => {
          if (id === 'r1') return { _id: 'r1', addToPortal: addToPortalR1 };
          if (id === 'r2') return { _id: 'r2', addToPortal: addToPortalR2 };
          return null;
        }),
      },
    };

    const result = await executeCreatePortalBulk(plugin, {
      payload: {
        parent_id: 'parent-1',
        items: [{ target_rem_id: 'r1' }, { target_rem_id: 'r2', position: 2 }],
      },
    });

    expect(moveRems).toHaveBeenCalledWith(['portal-1'], 'parent-1', 0);
    expect(moveRems).toHaveBeenCalledWith(['portal-2'], 'parent-1', 2);
    expect(addToPortalR1).toHaveBeenCalledWith('portal-1');
    expect(addToPortalR2).toHaveBeenCalledWith('portal-2');
    expect(result).toEqual({
      ok: true,
      parent_id: 'parent-1',
      created_count: 2,
      item_results: [
        { target_rem_id: 'r1', portal_id: 'portal-1' },
        { target_rem_id: 'r2', portal_id: 'portal-2' },
      ],
    });
  });

  it('preserves input order for implicit positions by executing the host writes in caller order', async () => {
    const moveRems = vi.fn(async () => {});

    let seq = 0;
    const plugin = {
      rem: {
        createPortal: vi.fn(async () => {
          seq += 1;
          return {
            _id: `portal-${seq}`,
            remove: vi.fn(async () => {}),
          };
        }),
        moveRems,
        findOne: vi.fn(async (id) => ({ _id: id, addToPortal: vi.fn(async () => {}) })),
      },
    };

    const result = await executeCreatePortalBulk(plugin, {
      payload: {
        parent_id: 'parent-1',
        items: [{ target_rem_id: 'r1' }, { target_rem_id: 'r2' }, { target_rem_id: 'r3' }],
      },
    });

    expect(moveRems).toHaveBeenNthCalledWith(1, ['portal-1'], 'parent-1', 1_000_000_000);
    expect(moveRems).toHaveBeenNthCalledWith(2, ['portal-2'], 'parent-1', 1_000_000_000);
    expect(moveRems).toHaveBeenNthCalledWith(3, ['portal-3'], 'parent-1', 1_000_000_000);
    expect(plugin.rem.findOne).toHaveBeenNthCalledWith(1, 'r1');
    expect(plugin.rem.findOne).toHaveBeenNthCalledWith(2, 'r2');
    expect(plugin.rem.findOne).toHaveBeenNthCalledWith(3, 'r3');
    expect(result.item_results.map((item) => item.target_rem_id)).toEqual(['r1', 'r2', 'r3']);
  });
});
