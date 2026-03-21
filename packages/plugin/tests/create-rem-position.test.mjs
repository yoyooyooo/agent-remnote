import { describe, expect, it, vi } from 'vitest';

import { executeCreateRem } from '../src/bridge/ops/handlers/remCrudOps.ts';

describe('plugin create_rem placement', () => {
  it('moves the created rem into the requested parent position', async () => {
    const setText = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const moveRems = vi.fn(async () => {});

    const createdRem = {
      _id: 'created-1',
      setText,
      remove,
    };

    const plugin = {
      rem: {
        createRem: vi.fn(async () => createdRem),
        moveRems,
      },
    };

    const result = await executeCreateRem(plugin, {
      payload: {
        parent_id: 'parent-1',
        position: 2,
        text: 'after sibling 1',
        client_temp_id: 'tmp:create-1',
      },
    });

    expect(moveRems).toHaveBeenCalledWith(['created-1'], 'parent-1', 2);
    expect(setText).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      created: {
        client_temp_id: 'tmp:create-1',
        remote_id: 'created-1',
        remote_type: 'rem',
      },
    });
  });
});
