import { OP_CATALOG } from './catalog.js';
import { canonicalizeOpType } from './normalize.js';

export type IdFieldPath = string;

export function idFieldPathsForOpType(opTypeRaw: unknown): readonly IdFieldPath[] {
  const opType = canonicalizeOpType(opTypeRaw);
  const entry = OP_CATALOG[opType];
  if (!entry) return [];
  return Array.isArray(entry.id_fields) ? entry.id_fields : [];
}
