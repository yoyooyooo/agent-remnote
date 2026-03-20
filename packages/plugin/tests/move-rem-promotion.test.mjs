import { describe, expect, it, vi } from 'vitest';

import { executeMoveRem } from '../src/bridge/ops/handlers/remCrudOps.ts';

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
});
