function parseStringRichText(str: string): any[] {
  const tokens: any[] = [];
  const referencePattern = /\(\(([^\s()|]+)(?:\|[^()]+)?\)\)/g;
  let lastIndex = 0;
  for (const match of str.matchAll(referencePattern)) {
    const before = str.slice(lastIndex, match.index ?? 0);
    if (before) tokens.push({ i: 'm', text: before });
    const refId = match[1];
    if (refId) tokens.push({ i: 'q', _id: refId });
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  const tail = str.slice(lastIndex);
  if (tail) tokens.push({ i: 'm', text: tail });
  return tokens.length > 0 ? tokens : [{ i: 'm', text: str }];
}

export function toRichText(input: any): any {
  if (input == null) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') return parseStringRichText(input);
  if (typeof input === 'object') return [input];
  return [{ i: 'm', text: String(input) }];
}
