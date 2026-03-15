import { describe, expect, it } from 'vitest';

function createPluginFixture() {
  let nextId = 1;
  const rems = new Map();
  const powerupCalls = [];

  const createRemRecord = (params) => {
    const id = params.id ?? `rem-${nextId++}`;
    const record = {
      _id: id,
      text: [params.text ?? ''],
      children: [],
      parent: params.parent ?? '',
      powerups: new Set(),
      powerupValues: new Map(),
      async remove() {
        const parent = rems.get(record.parent);
        if (parent) {
          parent.children = parent.children.filter((childId) => childId !== id);
        }
        rems.delete(id);
      },
      async setText(value) {
        record.text = Array.isArray(value) ? value : [String(value ?? '')];
      },
      async positionAmongstSiblings() {
        const parent = rems.get(record.parent);
        return parent ? parent.children.indexOf(id) : undefined;
      },
      async positionAmongstVisibleSiblings() {
        const parent = rems.get(record.parent);
        return parent ? parent.children.indexOf(id) : undefined;
      },
      async addPowerup(powerupCode) {
        record.powerups.add(String(powerupCode));
        powerupCalls.push({ type: 'addPowerup', remId: id, powerupCode: String(powerupCode) });
      },
      async setPowerupProperty(powerupCode, slotCode, value) {
        record.powerupValues.set(`${powerupCode}:${slotCode}`, value);
        powerupCalls.push({
          type: 'setPowerupProperty',
          remId: id,
          powerupCode: String(powerupCode),
          slotCode: String(slotCode),
          value,
        });
      },
      async setHiddenExplicitlyIncludedState(state, portalId) {
        record.hiddenState = state;
        record.hiddenPortalId = portalId ?? null;
      },
    };
    rems.set(id, record);
    if (record.parent) {
      const parent = rems.get(record.parent);
      if (parent) parent.children.push(id);
    }
    return record;
  };

  const moveRems = async (ids, newParentId, position) => {
    const parent = rems.get(newParentId);
    if (!parent) throw new Error(`parent not found: ${newParentId}`);

    for (const id of ids) {
      const rem = rems.get(id);
      if (!rem) continue;
      const oldParent = rems.get(rem.parent);
      if (oldParent) oldParent.children = oldParent.children.filter((childId) => childId !== id);
      rem.parent = newParentId;
    }

    const index = Math.max(0, Math.min(Number(position ?? parent.children.length), parent.children.length));
    parent.children.splice(index, 0, ...ids);
  };

  const plugin = {
    rem: {
      async findOne(id) {
        return rems.get(id) ?? null;
      },
      async createSingleRemWithMarkdown(markdown, parentId) {
        return createRemRecord({ text: String(markdown ?? ''), parent: parentId });
      },
      async createTreeWithMarkdown(markdown, parentId) {
        const items = String(markdown)
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => /^[-*+]\s+/.test(line))
          .map((line) => line.replace(/^[-*+]\s+/, ''));
        const effectiveItems = items.length > 0 ? items : [String(markdown).trim()].filter(Boolean);
        return effectiveItems.map((text) => createRemRecord({ text, parent: parentId }));
      },
      moveRems,
      async createRem() {
        return createRemRecord({ text: '', parent: '' });
      },
    },
    richText: {
      async parseFromMarkdown(markdown) {
        return [String(markdown ?? '')];
      },
    },
    focus: {
      async getFocusedPortal() {
        return null;
      },
    },
    editor: {
      async getSelection() {
        return null;
      },
    },
  };

  createRemRecord({ id: 'parent-1', text: 'Parent', parent: '' });
  createRemRecord({ id: 'old-1', text: 'Old 1', parent: 'parent-1' });
  createRemRecord({ id: 'old-2', text: 'Old 2', parent: 'parent-1' });

  return { plugin, rems, powerupCalls };
}

describe('children replace runtime behavior', () => {
  it('removes the temporary backup in default backup=none mode', async () => {
    const { plugin, rems } = createPluginFixture();
    globalThis.self = globalThis;
    const { executeReplaceChildrenWithMarkdown } = await import('../src/bridge/ops/handlers/markdownOps.ts');

    const result = await executeReplaceChildrenWithMarkdown(plugin, {
      payload: {
        parent_id: 'parent-1',
        markdown: '- New Root',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.backup_policy).toBe('none');
    expect(result.backup_deleted).toBe(true);
    expect(result.backup_rem_id).toBeNull();

    const parent = rems.get('parent-1');
    expect(parent.children).not.toContain('old-1');
    expect(parent.children).not.toContain('old-2');
  });

  it('keeps a visible backup when backup=visible', async () => {
    const { plugin, rems, powerupCalls } = createPluginFixture();
    globalThis.self = globalThis;
    const { executeReplaceChildrenWithMarkdown } = await import('../src/bridge/ops/handlers/markdownOps.ts');

    const result = await executeReplaceChildrenWithMarkdown(plugin, {
      op_id: 'op-1',
      txn_id: 'txn-1',
      op_type: 'replace_children_with_markdown',
      payload: {
        parent_id: 'parent-1',
        markdown: '- New Root',
        backup: 'visible',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.backup_policy).toBe('visible');
    expect(result.backup_deleted).toBe(false);
    expect(typeof result.backup_rem_id).toBe('string');

    const parent = rems.get('parent-1');
    const backup = rems.get(result.backup_rem_id);
    expect(parent.children).toContain(result.backup_rem_id);
    expect(backup.children).toEqual(['old-1', 'old-2']);
    expect([...backup.powerups]).toContain('agent_remnote_backup');
    expect(
      powerupCalls.some(
        (call) =>
          call.type === 'setPowerupProperty' &&
          call.remId === result.backup_rem_id &&
          call.slotCode === 'backup_kind',
      ),
    ).toBe(true);
    expect(
      powerupCalls.some(
        (call) =>
          call.type === 'setPowerupProperty' &&
          call.remId === result.backup_rem_id &&
          call.slotCode === 'cleanup_policy',
      ),
    ).toBe(true);
    expect(
      powerupCalls.some(
        (call) =>
          call.type === 'setPowerupProperty' &&
          call.remId === result.backup_rem_id &&
          call.slotCode === 'source_txn',
      ),
    ).toBe(true);
  });

  it('fails when single-root assertion is requested and markdown creates multiple roots', async () => {
    const { plugin, rems } = createPluginFixture();
    globalThis.self = globalThis;
    const { executeReplaceChildrenWithMarkdown } = await import('../src/bridge/ops/handlers/markdownOps.ts');

    const result = await executeReplaceChildrenWithMarkdown(plugin, {
      payload: {
        parent_id: 'parent-1',
        markdown: '- Root A\n- Root B',
        assertions: ['single-root'],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.fatal).toBe(true);
    expect(String(result.error)).toContain('single-root');

    const parent = rems.get('parent-1');
    expect(parent.children).toEqual(['old-1', 'old-2']);
  });

  it('removes the temporary backup for selection replace success path', async () => {
    const { plugin, rems } = createPluginFixture();
    globalThis.self = globalThis;
    const { executeReplaceSelectionWithMarkdown } = await import('../src/bridge/ops/handlers/markdownOps.ts');

    const result = await executeReplaceSelectionWithMarkdown(plugin, {
      op_id: 'op-sel-1',
      txn_id: 'txn-sel-1',
      op_type: 'replace_selection_with_markdown',
      payload: {
        markdown: '- New Root',
        target: {
          mode: 'explicit',
          rem_ids: ['old-1', 'old-2'],
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.backup_policy).toBe('none');
    expect(result.backup_deleted).toBe(true);
    expect(result.backup_rem_id).toBeNull();

    const parent = rems.get('parent-1');
    expect(parent.children).not.toContain('old-1');
    expect(parent.children).not.toContain('old-2');
  });

  it('does not nest a preexisting backup into the next visible backup', async () => {
    const { plugin, rems } = createPluginFixture();
    globalThis.self = globalThis;
    const { executeReplaceChildrenWithMarkdown } = await import('../src/bridge/ops/handlers/markdownOps.ts');

    const first = await executeReplaceChildrenWithMarkdown(plugin, {
      op_id: 'op-keep-1',
      txn_id: 'txn-keep-1',
      op_type: 'replace_children_with_markdown',
      payload: {
        parent_id: 'parent-1',
        markdown: '- First Root',
        backup: 'visible',
      },
    });
    expect(first.ok).toBe(true);

    const second = await executeReplaceChildrenWithMarkdown(plugin, {
      op_id: 'op-keep-2',
      txn_id: 'txn-keep-2',
      op_type: 'replace_children_with_markdown',
      payload: {
        parent_id: 'parent-1',
        markdown: '- Second Root',
        backup: 'visible',
      },
    });

    expect(second.ok).toBe(true);
    const parent = rems.get('parent-1');
    const oldBackup = rems.get(first.backup_rem_id);
    const newBackup = rems.get(second.backup_rem_id);

    expect(parent.children).toContain(first.backup_rem_id);
    expect(parent.children).toContain(second.backup_rem_id);
    expect(newBackup.children).not.toContain(first.backup_rem_id);
    expect(second.ignored_backup_rem_ids).toContain(first.backup_rem_id);
    expect(oldBackup.parent).toBe('parent-1');
  });

  it('defers deletion for large backup=none subtrees and hides the backup rem', async () => {
    const { plugin, rems } = createPluginFixture();
    globalThis.self = globalThis;

    const old1 = rems.get('old-1');
    for (let i = 0; i < 60; i += 1) {
      const id = `deep-${i}`;
      rems.set(id, {
        _id: id,
        text: [`deep ${i}`],
        children: [],
        parent: i === 0 ? 'old-1' : `deep-${i - 1}`,
        async remove() {
          rems.delete(id);
        },
      });
      if (i === 0) old1.children.push(id);
      else rems.get(`deep-${i - 1}`).children.push(id);
    }

    const { executeReplaceChildrenWithMarkdown } = await import('../src/bridge/ops/handlers/markdownOps.ts');

    const result = await executeReplaceChildrenWithMarkdown(plugin, {
      op_id: 'op-large-1',
      txn_id: 'txn-large-1',
      op_type: 'replace_children_with_markdown',
      payload: {
        parent_id: 'parent-1',
        markdown: '- New Root',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.backup_policy).toBe('none');
    expect(result.backup_deleted).toBe(false);
    expect(result.backup_hidden).toBe(true);
    expect(typeof result.backup_rem_id).toBe('string');

    const backup = rems.get(result.backup_rem_id);
    expect(backup.hiddenState).toBe('hidden');
  });
});
