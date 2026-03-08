import { OP_CATALOG, type OpCatalogEntry } from './catalog.js';

function normalizeOpTypeInput(opTypeRaw: unknown): string {
  return typeof opTypeRaw === 'string' ? opTypeRaw.trim() : '';
}

const OP_ALIAS_TO_TYPE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(OP_CATALOG).flatMap(([type, entry]) => {
      const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
      return aliases.map((alias) => [alias, type] as const);
    }),
  ),
);

export function canonicalizeOpType(opTypeRaw: unknown): string {
  const opType = normalizeOpTypeInput(opTypeRaw);
  if (!opType) return '';
  if ((OP_CATALOG as Record<string, OpCatalogEntry>)[opType]) return opType;
  return OP_ALIAS_TO_TYPE[opType] ?? opType;
}

export function resolveOpCatalogEntry(opTypeRaw: unknown): OpCatalogEntry | undefined {
  const canonicalType = canonicalizeOpType(opTypeRaw);
  if (!canonicalType) return undefined;
  return (OP_CATALOG as Record<string, OpCatalogEntry>)[canonicalType];
}
