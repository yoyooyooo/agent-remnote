import { describe, expect, it } from 'vitest';

describe('delete rem runtime behavior', () => {
  it('deletes a large subtree via safeDeleteSubtree when root removal is gated', async () => {
    globalThis.self = globalThis;
    const { executeDeleteRem } = await import('../src/bridge/ops/handlers/remCrudOps.ts');

    const rems = new Map();

    const subtreeSize = (id) => {
      const rem = rems.get(id);
      if (!rem) return 0;
      return 1 + rem.children.reduce((sum, childId) => sum + subtreeSize(childId), 0);
    };

    const removeSubtree = (id) => {
      const rem = rems.get(id);
      if (!rem) return;
      for (const childId of [...rem.children]) removeSubtree(childId);
      if (rem.parent) {
        const parent = rems.get(rem.parent);
        if (parent) parent.children = parent.children.filter((childId) => childId !== id);
      }
      rems.delete(id);
    };

    const attach = (id, parentId = '') => {
      const record = {
        _id: id,
        parent: parentId,
        children: [],
        async remove() {
          if (subtreeSize(id) > 50) return;
          removeSubtree(id);
        },
      };
      rems.set(id, record);
      if (parentId) rems.get(parentId).children.push(id);
      return record;
    };

    attach('root-1');
    for (const child of ['a', 'b', 'c']) {
      attach(`child-${child}`, 'root-1');
      for (let i = 1; i <= 9; i += 1) attach(`${child}-${i}`, `child-${child}`);
    }

    const plugin = {
      rem: {
        async findOne(id) {
          return rems.get(id) ?? null;
        },
      },
    };

    const result = await executeDeleteRem(plugin, {
      payload: { rem_id: 'root-1' },
    });

    expect(result).toEqual({
      ok: true,
      deleted: true,
      existed: true,
      delete_mode: 'direct',
      node_count: 31,
      batch_count: 1,
    });
    expect(rems.size).toBe(0);
  });

  it('honors max_delete_subtree_nodes from payload over the frontend default', async () => {
    globalThis.self = globalThis;
    const { executeDeleteRem } = await import('../src/bridge/ops/handlers/remCrudOps.ts');

    const rems = new Map();

    const subtreeSize = (id) => {
      const rem = rems.get(id);
      if (!rem) return 0;
      return 1 + rem.children.reduce((sum, childId) => sum + subtreeSize(childId), 0);
    };

    const removeSubtree = (id) => {
      const rem = rems.get(id);
      if (!rem) return;
      for (const childId of [...rem.children]) removeSubtree(childId);
      if (rem.parent) {
        const parent = rems.get(rem.parent);
        if (parent) parent.children = parent.children.filter((childId) => childId !== id);
      }
      rems.delete(id);
    };

    const attach = (id, parentId = '') => {
      const record = {
        _id: id,
        parent: parentId,
        children: [],
        async remove() {
          if (subtreeSize(id) > 10) return;
          removeSubtree(id);
        },
      };
      rems.set(id, record);
      if (parentId) rems.get(parentId).children.push(id);
      return record;
    };

    attach('root-1');
    for (const child of ['a', 'b', 'c']) {
      attach(`child-${child}`, 'root-1');
      for (let i = 1; i <= 9; i += 1) attach(`${child}-${i}`, `child-${child}`);
    }

    const plugin = {
      rem: {
        async findOne(id) {
          return rems.get(id) ?? null;
        },
      },
    };

    const result = await executeDeleteRem(plugin, {
      payload: { rem_id: 'root-1', max_delete_subtree_nodes: 10 },
    });

    expect(result).toEqual({
      ok: true,
      deleted: true,
      existed: true,
      delete_mode: 'bottom_up',
      node_count: 31,
      batch_count: 4,
    });
    expect(rems.size).toBe(0);
  });
});
