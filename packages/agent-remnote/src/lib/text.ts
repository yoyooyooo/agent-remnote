export function trimBoundaryBlankLines(input: string): string {
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

export function dropBlankLinesOutsideFences(input: string): string {
  const normalized = input.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence && line.trim().length === 0) continue;
    out.push(line);
  }
  return out.join('\n');
}

const STRUCTURED_MARKDOWN_LINE_RE = /^\s{0,3}(?:#{1,6}\s+\S|[-*+]\s+\S|\d+\.\s+\S|```|~~~)/m;

export function looksLikeStructuredMarkdown(input: string): boolean {
  const normalized = input.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return false;
  return STRUCTURED_MARKDOWN_LINE_RE.test(normalized);
}
