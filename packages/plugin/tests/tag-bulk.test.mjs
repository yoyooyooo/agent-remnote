import { describe, expect, it, vi } from 'vitest';

import { executeAddTagBulk, executeRemoveTagBulk } from '../src/bridge/ops/handlers/metaOps.ts';

describe('plugin tag bulk handlers', () => {
  it('adds tags across multiple rems and returns per-item results', async () => {
    const addTag1 = vi.fn(async () => {});
    const addTag2 = vi.fn(async () => {});

    const plugin = {
      rem: {
        findOne: vi.fn(async (id) => {
          if (id === 'r1') return { _id: 'r1', addTag: addTag1 };
          if (id === 'r2') return { _id: 'r2', addTag: addTag2 };
          return null;
        }),
      },
    };

    const result = await executeAddTagBulk(plugin, {
      payload: {
        items: [
          { rem_id: 'r1', tag_id: 't1' },
          { rem_id: 'r2', tag_id: 't1' },
        ],
      },
    });

    expect(addTag1).toHaveBeenCalledWith('t1');
    expect(addTag2).toHaveBeenCalledWith('t1');
    expect(result).toEqual({
      ok: true,
      item_results: [
        { rem_id: 'r1', tag_id: 't1' },
        { rem_id: 'r2', tag_id: 't1' },
      ],
      changed_count: 2,
    });
  });

  it('removes tags across multiple rems and forwards remove_properties', async () => {
    const removeTag1 = vi.fn(async () => {});
    const removeTag2 = vi.fn(async () => {});

    const plugin = {
      rem: {
        findOne: vi.fn(async (id) => {
          if (id === 'r1') return { _id: 'r1', removeTag: removeTag1 };
          if (id === 'r2') return { _id: 'r2', removeTag: removeTag2 };
          return null;
        }),
      },
    };

    const result = await executeRemoveTagBulk(plugin, {
      payload: {
        items: [
          { rem_id: 'r1', tag_id: 't1' },
          { rem_id: 'r2', tag_id: 't1' },
        ],
        remove_properties: true,
      },
    });

    expect(removeTag1).toHaveBeenCalledWith('t1', true);
    expect(removeTag2).toHaveBeenCalledWith('t1', true);
    expect(result).toEqual({
      ok: true,
      item_results: [
        { rem_id: 'r1', tag_id: 't1' },
        { rem_id: 'r2', tag_id: 't1' },
      ],
      changed_count: 2,
      remove_properties: true,
    });
  });
});
