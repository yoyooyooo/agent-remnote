import type { OutlineWriteShape } from './model.js';

const STRUCTURED_MARKDOWN_LINE_RE = /^\s{0,3}(?:#{1,6}\s+\S|[-*+]\s+\S|\d+\.\s+\S|```|~~~)/m;
const ROOT_HEADING_RE = /^#{1,6}\s+\S/;
const ROOT_LIST_ITEM_RE = /^(?:[-*+]|\d+\.)\s+\S/;

function looksLikeStructuredMarkdown(input: string): boolean {
  const normalized = input.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return false;
  return STRUCTURED_MARKDOWN_LINE_RE.test(normalized);
}

function trimBoundaryBlankLinesLocal(input: string): string {
  const normalized = input.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  let start = 0;
  while (start < lines.length && lines[start]?.trim().length === 0) start += 1;
  if (start >= lines.length) return '';

  let end = lines.length - 1;
  while (end >= start && lines[end]?.trim().length === 0) end -= 1;
  if (end < start) return '';

  let inFence = false;
  for (let i = start; i <= end; i += 1) {
    if (/^\s*```/.test(lines[i] ?? '')) inFence = !inFence;
  }

  const keptEnd = inFence ? lines.length - 1 : end;
  return lines.slice(start, keptEnd + 1).join('\n');
}

function countTopLevelMarkdownRoots(input: string): number {
  const normalized = trimBoundaryBlankLinesLocal(input.replace(/\r\n?/g, '\n'));
  if (!normalized) return 0;

  const lines = normalized.split('\n');
  const commonIndent =
    lines
      .filter((line) => line.trim().length > 0)
      .reduce<number | null>((min, line) => {
        const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
        return min === null ? indent : Math.min(min, indent);
      }, null) ?? 0;
  let inFence = false;
  let count = 0;

  for (const rawLine of lines) {
    const line = rawLine.slice(commonIndent);
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[ \t]/.test(line)) continue;
    if (ROOT_HEADING_RE.test(trimmed)) {
      count += 1;
      continue;
    }
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
