import { describe, expect, it, vi } from 'vitest';

import { createTreeWithMarkdownAndFixRefs } from '../src/bridge/remnote/markdown.ts';

function createPluginMock() {
  const createTreeWithMarkdown = vi.fn(async () => []);
  return {
    plugin: {
      rem: {
        createTreeWithMarkdown,
      },
    },
    createTreeWithMarkdown,
  };
}

describe('createTreeWithMarkdownAndFixRefs', () => {
  it('normalizes a single unordered list item before tree import', async () => {
    const { plugin, createTreeWithMarkdown } = createPluginMock();

    await createTreeWithMarkdownAndFixRefs(plugin, '- report root', 'parent-rem');

    expect(createTreeWithMarkdown).toHaveBeenCalledWith('report root', 'parent-rem');
  });

  it('preserves nested list structure', async () => {
    const { plugin, createTreeWithMarkdown } = createPluginMock();

    await createTreeWithMarkdownAndFixRefs(plugin, '- root\n  - child', 'parent-rem');

    expect(createTreeWithMarkdown).toHaveBeenCalledWith('- root\n  - child', 'parent-rem');
  });
});
