import { OP_CATALOG } from './catalog.js';

export type IdFieldPath = string;

export function idFieldPathsForOpType(opTypeRaw: unknown): readonly IdFieldPath[] {
  const opType = typeof opTypeRaw === 'string' ? opTypeRaw.trim() : '';
  const entry = OP_CATALOG[opType];
  if (!entry) return [];
  return Array.isArray(entry.id_fields) ? entry.id_fields : [];
}
