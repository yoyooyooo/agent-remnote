import { describe, expect, it } from 'vitest';

function createPluginFixture() {
  let nextId = 1;
  const rems = new Map();

  const attachToParent = (id, parentId, position) => {
    const parent = rems.get(parentId);
    if (!parent) throw new Error(`parent not found: ${parentId}`);
    const insertAt =
      typeof position === 'number' && Number.isFinite(position)
        ? Math.max(0, Math.min(Math.floor(position), parent.children.length))
        : parent.children.length;
    parent.children.splice(insertAt, 0, id);
  };

  const detachFromParent = (id, parentId) => {
    const parent = rems.get(parentId);
    if (!parent) return;
    parent.children = parent.children.filter((childId) => childId !== id);
  };

  const createRemRecord = ({ id, text, parent = '' }) => {
    const remId = id ?? `rem-${nextId++}`;
    const record = {
      _id: remId,
      text: [String(text ?? '')],
      children: [],
      parent,
      async remove() {
        if (record.parent) detachFromParent(remId, record.parent);
        rems.delete(remId);
      },
      async setText(value) {
        record.text = Array.isArray(value) ? value : [String(value ?? '')];
      },
      async positionAmongstSiblings() {
        const parentRecord = rems.get(record.parent);
        return parentRecord ? parentRecord.children.indexOf(remId) : undefined;
      },
      async positionAmongstVisibleSiblings() {
        const parentRecord = rems.get(record.parent);
        return parentRecord ? parentRecord.children.indexOf(remId) : undefined;
      },
    };
    rems.set(remId, record);
    if (parent) attachToParent(remId, parent);
    return record;
  };

  const moveRems = async (ids, newParentId, position) => {
    for (const id of ids) {
      const rem = rems.get(id);
      if (!rem) continue;
      if (rem.parent) detachFromParent(id, rem.parent);
      rem.parent = newParentId;
    }

    const parent = rems.get(newParentId);
    if (!parent) throw new Error(`parent not found: ${newParentId}`);
    const insertAt =
      typeof position === 'number' && Number.isFinite(position)
        ? Math.max(0, Math.min(Math.floor(position), parent.children.length))
        : parent.children.length;
    parent.children.splice(insertAt, 0, ...ids);
  };

  const createTreeWithMarkdown = async (markdown, parentId) => {
    const created = [];
    const stack = [{ level: -1, parentId }];
    const lines = String(markdown ?? '').split('\n');

    for (const line of lines) {
      const match = line.match(/^(\s*)[-*+]\s+(.*)$/);
      if (!match) continue;

      const level = Math.floor((match[1] ?? '').length / 2);
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      const record = createRemRecord({
        text: match[2] ?? '',
        parent: stack[stack.length - 1].parentId,
      });
      created.push(record);
      stack.push({ level, parentId: record._id });
    }

    return created;
  };

  const plugin = {
    rem: {
      async findOne(id) {
        return rems.get(id) ?? null;
      },
      async createSingleRemWithMarkdown(markdown, parentId) {
        return createRemRecord({ text: markdown, parent: parentId });
      },
      createTreeWithMarkdown,
      moveRems,
    },
    richText: {
      async parseFromMarkdown(markdown) {
        return [String(markdown ?? '')];
      },
    },
  };

  createRemRecord({ id: 'page-1', text: 'Page Root' });

  return { plugin, rems };
}

function readChildTexts(rems, parentId) {
  const parent = rems.get(parentId);
  if (!parent) return [];
  return parent.children.map((childId) => String(rems.get(childId)?.text?.join('') ?? ''));
}

describe('create_tree_with_markdown runtime behavior', () => {
  it('keeps multiple top-level bullets as siblings under the target parent', async () => {
    const { plugin, rems } = createPluginFixture();
    globalThis.self = globalThis;
    const { executeCreateTreeWithMarkdown } = await import('../src/bridge/ops/handlers/markdownOps.ts');

    const result = await executeCreateTreeWithMarkdown(plugin, {
      payload: {
        parent_id: 'page-1',
        markdown: ['- Purpose', '  - First section', '- What', '  - Second section', '- Why', '  - Third section'].join(
          '\n',
        ),
      },
    });

    expect(result.ok).toBe(true);
    expect(readChildTexts(rems, 'page-1')).toEqual(['Purpose', 'What', 'Why']);

    const [purposeId, whatId, whyId] = rems.get('page-1').children;
    expect(readChildTexts(rems, purposeId)).toEqual(['First section']);
    expect(readChildTexts(rems, whatId)).toEqual(['Second section']);
    expect(readChildTexts(rems, whyId)).toEqual(['Third section']);
  });
});
