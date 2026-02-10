import { deriveConflictKeys, type ConflictKey } from '../conflicts/deriveConflictKeys.js';

export type WriteFootprint = {
  readonly conflict_keys: readonly ConflictKey[];
};

// A conservative write footprint used for conflict scheduling / safe batching.
export function deriveWriteFootprint(opTypeRaw: unknown, payload: unknown): WriteFootprint {
  return { conflict_keys: deriveConflictKeys(opTypeRaw, payload) };
}

