export function createPreview(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return {
      title: '(empty)',
      snippet: '',
      truncated: false,
    };
  }

  const snippet = normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
  const title = normalized.split(/\n| - |——|。|！|？|\.|: /)[0]?.trim() || normalized.slice(0, 80);
  return {
    title: title.slice(0, 120),
    snippet,
    truncated: normalized.length > maxLength,
  };
}

export function coalesceText(kt: unknown, ke: unknown): string {
  const combined = [kt, ke]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(' | ');
  return combined;
}

export function stringifyAncestor(
  text: unknown,
  ids: unknown,
): {
  text: string;
  ids: string[];
} {
  const ancestorText = typeof text === 'string' ? text.trim() : '';
  const ancestorIds = typeof ids === 'string' ? ids.trim().split(/\s+/).filter(Boolean) : [];
  return {
    text: ancestorText,
    ids: ancestorIds,
  };
}
