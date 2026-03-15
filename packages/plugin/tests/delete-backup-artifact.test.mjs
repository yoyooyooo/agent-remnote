import { describe, expect, it } from 'vitest';

describe('delete backup artifact runtime behavior', () => {
  it('fails when rem.remove returns but the backup rem still exists', async () => {
    globalThis.self = globalThis;
    const { executeDeleteBackupArtifact } = await import('../src/bridge/ops/handlers/remCrudOps.ts');

    let removed = false;
    const rem = {
      _id: 'backup-1',
      async remove() {
        removed = true;
      },
    };

    const plugin = {
      rem: {
        async findOne(id) {
          if (id !== 'backup-1') return null;
          return rem;
        },
      },
    };

    const result = await executeDeleteBackupArtifact(plugin, {
      payload: { rem_id: 'backup-1' },
    });

    expect(removed).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(true);
    expect(String(result.error)).toContain('still exists');
  });

  it('succeeds when the backup rem is gone after remove', async () => {
    globalThis.self = globalThis;
    const { executeDeleteBackupArtifact } = await import('../src/bridge/ops/handlers/remCrudOps.ts');

    let rem = {
      _id: 'backup-1',
      async remove() {
        rem = null;
      },
    };

    const plugin = {
      rem: {
        async findOne(id) {
          if (id !== 'backup-1') return null;
          return rem;
        },
      },
    };

    const result = await executeDeleteBackupArtifact(plugin, {
      payload: { rem_id: 'backup-1' },
    });

    expect(result).toEqual({
      ok: true,
      rem_id: 'backup-1',
      deleted: true,
      existed: true,
      delete_mode: 'direct',
      node_count: 1,
      batch_count: 1,
    });
  });

  it('waits for delayed removal before declaring failure', async () => {
    globalThis.self = globalThis;
    const { executeDeleteBackupArtifact } = await import('../src/bridge/ops/handlers/remCrudOps.ts');

    let rem = {
      _id: 'backup-1',
      async remove() {
        setTimeout(() => {
          rem = null;
        }, 30);
      },
    };

    const plugin = {
      rem: {
        async findOne(id) {
          if (id !== 'backup-1') return null;
          return rem;
        },
      },
    };

    const result = await executeDeleteBackupArtifact(plugin, {
      payload: { rem_id: 'backup-1' },
    });

    expect(result).toEqual({
      ok: true,
      rem_id: 'backup-1',
      deleted: true,
      existed: true,
      delete_mode: 'direct',
      node_count: 1,
      batch_count: 1,
    });
  });

  it('deletes a large backup subtree via multiple safe subtree deletes when direct root removal is gated', async () => {
    globalThis.self = globalThis;
    const { executeDeleteBackupArtifact } = await import('../src/bridge/ops/handlers/remCrudOps.ts');

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

    attach('backup-1');
    for (const child of ['a', 'b', 'c']) {
      attach(`child-${child}`, 'backup-1');
      for (let i = 1; i <= 9; i += 1) attach(`${child}-${i}`, `child-${child}`);
    }

    const plugin = {
      rem: {
        async findOne(id) {
          return rems.get(id) ?? null;
        },
      },
    };

    const result = await executeDeleteBackupArtifact(plugin, {
      payload: { rem_id: 'backup-1' },
    });

    expect(result).toEqual({
      ok: true,
      rem_id: 'backup-1',
      deleted: true,
      existed: true,
      delete_mode: 'direct',
      node_count: 31,
      batch_count: 1,
    });
    expect(rems.size).toBe(0);
  });
});
