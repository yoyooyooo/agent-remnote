import { describe, expect, it, vi } from 'vitest';

import { executeAddSourceBulk, executeRemoveSourceBulk } from '../src/bridge/ops/handlers/metaOps.ts';

describe('plugin source bulk handlers', () => {
  it('adds sources across multiple rems and returns per-item results', async () => {
    const addSource1 = vi.fn(async () => {});
    const addSource2 = vi.fn(async () => {});

    const plugin = {
      rem: {
        findOne: vi.fn(async (id) => {
          if (id === 'r1') return { _id: 'r1', addSource: addSource1 };
          if (id === 'r2') return { _id: 'r2', addSource: addSource2 };
          return null;
        }),
      },
    };

    const result = await executeAddSourceBulk(plugin, {
      payload: {
        items: [
          { rem_id: 'r1', source_id: 's1' },
          { rem_id: 'r2', source_id: 's1' },
        ],
      },
    });

    expect(addSource1).toHaveBeenCalledWith('s1');
    expect(addSource2).toHaveBeenCalledWith('s1');
    expect(result).toEqual({
      ok: true,
      item_results: [
        { rem_id: 'r1', source_id: 's1' },
        { rem_id: 'r2', source_id: 's1' },
      ],
      changed_count: 2,
    });
  });

  it('removes sources across multiple rems and returns per-item results', async () => {
    const removeSource1 = vi.fn(async () => {});
    const removeSource2 = vi.fn(async () => {});

    const plugin = {
      rem: {
        findOne: vi.fn(async (id) => {
          if (id === 'r1') return { _id: 'r1', removeSource: removeSource1 };
          if (id === 'r2') return { _id: 'r2', removeSource: removeSource2 };
          return null;
        }),
      },
    };

    const result = await executeRemoveSourceBulk(plugin, {
      payload: {
        items: [
          { rem_id: 'r1', source_id: 's1' },
          { rem_id: 'r2', source_id: 's1' },
        ],
      },
    });

    expect(removeSource1).toHaveBeenCalledWith('s1');
    expect(removeSource2).toHaveBeenCalledWith('s1');
    expect(result).toEqual({
      ok: true,
      item_results: [
        { rem_id: 'r1', source_id: 's1' },
        { rem_id: 'r2', source_id: 's1' },
      ],
      changed_count: 2,
    });
  });
});
