import type { OutlineWriteShape } from './model.js';

const STRUCTURED_MARKDOWN_LINE_RE = /^\s{0,3}(?:#{1,6}\s+\S|[-*+]\s+\S|\d+\.\s+\S|```|~~~)/m;
const ROOT_HEADING_RE = /^#{1,6}\s+\S/;
const ROOT_LIST_ITEM_RE = /^(?:[-*+]|\d+\.)\s+\S/;

function looksLikeStructuredMarkdown(input: string): boolean {
  const normalized = input.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return false;
  return STRUCTURED_MARKDOWN_LINE_RE.test(normalized);
}

function countTopLevelMarkdownRoots(input: string): number {
  const normalized = input.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return 0;

  const lines = normalized.split('\n');
  let inFence = false;
  let count = 0;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (ROOT_HEADING_RE.test(trimmed)) {
      count += 1;
      continue;
    }
    if (line.startsWith(' ')) continue;
    if (ROOT_LIST_ITEM_RE.test(trimmed)) count += 1;
  }

  return count;
}

export type OutlineSuitability = {
  readonly shape: OutlineWriteShape;
  readonly outline_suitable: boolean;
  readonly top_level_roots: number;
};

export function decideOutlineWriteShape(params: {
  readonly markdown?: string | undefined;
  readonly preserveAnchor?: boolean | undefined;
}): OutlineSuitability {
  if (params.preserveAnchor === true) {
    return {
      shape: 'expand_in_place',
      outline_suitable: true,
      top_level_roots: 0,
    };
  }

  const markdown = typeof params.markdown === 'string' ? params.markdown : '';
  const topLevelRoots = countTopLevelMarkdownRoots(markdown);
  const structured = looksLikeStructuredMarkdown(markdown);

  if (structured && topLevelRoots === 1) {
    return {
      shape: 'single_root_outline',
      outline_suitable: true,
      top_level_roots: 1,
    };
  }

  return {
    shape: 'normal',
    outline_suitable: false,
    top_level_roots: topLevelRoots,
  };
}
