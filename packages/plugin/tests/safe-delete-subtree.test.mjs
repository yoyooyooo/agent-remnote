import { describe, expect, it } from 'vitest';

function createPluginFixture(maxSafeSubtreeSize) {
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
        if (subtreeSize(id) > maxSafeSubtreeSize) return;
        removeSubtree(id);
      },
    };
    rems.set(id, record);
    if (parentId) rems.get(parentId).children.push(id);
    return record;
  };

  const plugin = {
    rem: {
      async findOne(id) {
        return rems.get(id) ?? null;
      },
    },
  };

  return { plugin, rems, attach };
}

describe('safe delete subtree helper', () => {
  it('directly deletes a small subtree when the whole subtree is under the safe threshold', async () => {
    globalThis.self = globalThis;
    const { safeDeleteSubtree } = await import('../src/bridge/remnote/safeDeleteSubtree.ts');
    const { plugin, rems, attach } = createPluginFixture(50);

    attach('root-1');
    attach('child-1', 'root-1');
    attach('child-2', 'root-1');
    attach('child-3', 'root-1');
    attach('child-4', 'root-1');
    attach('child-5', 'root-1');

    const result = await safeDeleteSubtree(plugin, 'root-1', {
      maxDeleteSubtreeNodes: 50,
    });

    expect(result).toEqual({
      existed: true,
      deleted: true,
      mode: 'direct',
      nodeCount: 6,
      batchCount: 1,
    });
    expect(rems.size).toBe(0);
  });

  it('partitions a large tree into multiple safe subtree deletes under the configured threshold', async () => {
    globalThis.self = globalThis;
    const { safeDeleteSubtree } = await import('../src/bridge/remnote/safeDeleteSubtree.ts');
    const { plugin, rems, attach } = createPluginFixture(50);

    attach('root-1');
    for (const child of ['a', 'b', 'c']) {
      attach(`child-${child}`, 'root-1');
      for (let i = 1; i <= 9; i += 1) attach(`${child}-${i}`, `child-${child}`);
    }

    const result = await safeDeleteSubtree(plugin, 'root-1', {
      maxDeleteSubtreeNodes: 50,
    });

    expect(result).toEqual({
      existed: true,
      deleted: true,
      mode: 'direct',
      nodeCount: 31,
      batchCount: 1,
    });
    expect(rems.size).toBe(0);
  });
});
