import { describe, expect, it, vi } from 'vitest';

import { executeSetTodoStatusBulk } from '../src/bridge/ops/handlers/metaOps.ts';

describe('plugin todo status bulk handlers', () => {
  it('sets todo status across multiple rems and returns per-item results', async () => {
    const setTodoStatus1 = vi.fn(async () => {});
    const setTodoStatus2 = vi.fn(async () => {});

    const plugin = {
      rem: {
        findOne: vi.fn(async (id) => {
          if (id === 'r1') return { _id: 'r1', setTodoStatus: setTodoStatus1 };
          if (id === 'r2') return { _id: 'r2', setTodoStatus: setTodoStatus2 };
          return null;
        }),
      },
    };

    const result = await executeSetTodoStatusBulk(plugin, {
      payload: {
        items: [
          { rem_id: 'r1', status: 'finished' },
          { rem_id: 'r2', status: 'finished' },
        ],
      },
    });

    expect(setTodoStatus1).toHaveBeenCalledWith('finished');
    expect(setTodoStatus2).toHaveBeenCalledWith('finished');
    expect(result).toEqual({
      ok: true,
      item_results: [
        { rem_id: 'r1', status: 'finished' },
        { rem_id: 'r2', status: 'finished' },
      ],
      changed_count: 2,
    });
  });
});
