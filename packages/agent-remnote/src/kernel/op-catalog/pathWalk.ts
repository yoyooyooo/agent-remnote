export type PathToken = { readonly key: string; readonly isArray: boolean };

export function parsePathTokens(path: string): readonly PathToken[] {
  return path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const isArray = part.endsWith('[]');
      const key = isArray ? part.slice(0, -2).trim() : part;
      return { key, isArray } as const;
    })
    .filter((token) => token.key.length > 0);
}

export function collectLeafValues(value: unknown, path: readonly PathToken[], idx = 0): readonly unknown[] {
  if (idx >= path.length) return [value];
  if (!value || typeof value !== 'object') return [];

  const token = path[idx]!;
  const next = (value as any)[token.key];

  if (token.isArray) {
    if (!Array.isArray(next)) return [];
    const out: unknown[] = [];
    for (const item of next) {
      out.push(...collectLeafValues(item, path, idx + 1));
    }
    return out;
  }

  return collectLeafValues(next, path, idx + 1);
}

export function mapLeafValuesInPlace(
  value: unknown,
  path: readonly PathToken[],
  mapFn: (leaf: unknown) => unknown,
  idx = 0,
): void {
  if (idx >= path.length) return;
  if (!value || typeof value !== 'object') return;

  const token = path[idx]!;
  const isLeaf = idx === path.length - 1;

  if (token.isArray) {
    const next = (value as any)[token.key];
    if (!Array.isArray(next)) return;

    if (isLeaf) {
      (value as any)[token.key] = next.map((item: unknown) => mapFn(item));
      return;
    }

    for (const item of next) {
      mapLeafValuesInPlace(item, path, mapFn, idx + 1);
    }
    return;
  }

  if (isLeaf) {
    (value as any)[token.key] = mapFn((value as any)[token.key]);
    return;
  }

  mapLeafValuesInPlace((value as any)[token.key], path, mapFn, idx + 1);
}
