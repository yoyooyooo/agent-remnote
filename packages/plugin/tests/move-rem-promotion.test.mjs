import { describe, expect, it, vi } from 'vitest';

import { executeMoveRem, executeMoveRemBulk } from '../src/bridge/ops/handlers/remCrudOps.ts';

describe('plugin move_rem promotion', () => {
  it('moves a Rem to standalone and leaves a portal at the original location', async () => {
    const setParent = vi.fn(async () => {});
    const setIsDocument = vi.fn(async () => {});
    const positionAmongstSiblings = vi.fn(async () => 3);
    const addToPortal = vi.fn(async () => {});
    const portalRemove = vi.fn(async () => {});
    const moveRems = vi.fn(async () => {});

    const rem = {
      _id: 'r1',
      parent: 'p1',
      setParent,
      setIsDocument,
      positionAmongstSiblings,
      addToPortal,
    };

    const portal = {
      _id: 'portal-1',
      remove: portalRemove,
    };

    const plugin = {
      rem: {
        findOne: vi.fn(async (id) => (id === 'r1' ? rem : null)),
        createPortal: vi.fn(async () => portal),
        moveRems,
      },
    };

    const result = await executeMoveRem(plugin, {
      payload: {
        rem_id: 'r1',
        standalone: true,
        is_document: true,
        leave_portal: true,
      },
    });

    expect(setParent).toHaveBeenCalledWith(null);
    expect(setIsDocument).toHaveBeenCalledWith(true);
    expect(moveRems).toHaveBeenCalledWith(['portal-1'], 'p1', 3);
    expect(addToPortal).toHaveBeenCalledWith('portal-1');
    expect(portalRemove).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      rem_id: 'r1',
      standalone: true,
      leave_portal: true,
      portal_created: true,
      portal_id: 'portal-1',
      source_parent_id: 'p1',
    });
  });

  it('warns when source position cannot be resolved but still completes the move', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setParent = vi.fn(async () => {});
    const positionAmongstSiblings = vi.fn(async () => {
      throw new Error('position failed');
    });
    const addToPortal = vi.fn(async () => {});
    const portalRemove = vi.fn(async () => {});
    const moveRems = vi.fn(async () => {});

    const rem = {
      _id: 'r1',
      parent: 'p1',
      setParent,
      positionAmongstSiblings,
      addToPortal,
    };

    const portal = {
      _id: 'portal-1',
      remove: portalRemove,
    };

    const plugin = {
      rem: {
        findOne: vi.fn(async (id) => (id === 'r1' ? rem : null)),
        createPortal: vi.fn(async () => portal),
        moveRems,
      },
    };

    const result = await executeMoveRem(plugin, {
      payload: {
        rem_id: 'r1',
        standalone: true,
        leave_portal: true,
      },
    });

    expect(warn).toHaveBeenCalledWith('[agent-remnote][move] failed to get source position', expect.any(Object));
    expect(moveRems).toHaveBeenCalledWith(['portal-1'], 'p1', 0);
    expect(result).toMatchObject({
      ok: true,
      portal_created: true,
    });

    warn.mockRestore();
  });

  it('moves multiple Rems through one bulk op while preserving item order', async () => {
    const moveRems = vi.fn(async () => {});

    const plugin = {
      rem: {
        moveRems,
      },
    };

    const result = await executeMoveRemBulk(plugin, {
      payload: {
        rem_ids: ['r1', 'r2', 'r3'],
        new_parent_id: 'p2',
      },
    });

    expect(moveRems).toHaveBeenNthCalledWith(1, ['r1'], 'p2', 0);
    expect(moveRems).toHaveBeenNthCalledWith(2, ['r2'], 'p2', 1);
    expect(moveRems).toHaveBeenNthCalledWith(3, ['r3'], 'p2', 2);
    expect(result).toEqual({
      ok: true,
      rem_ids: ['r1', 'r2', 'r3'],
      new_parent_id: 'p2',
      moved_count: 3,
    });
  });
});
