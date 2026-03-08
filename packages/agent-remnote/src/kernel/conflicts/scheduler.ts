import type { ConflictKey } from './deriveConflictKeys.js';

export type CandidateOp = {
  readonly op_id: string;
  readonly txn_id: string;
  readonly op_type: string;
  readonly payload: unknown;
};

export type SchedulerPickResult = {
  readonly selected: readonly CandidateOp[];
  readonly skipped: number;
  readonly usedKeys: ReadonlySet<ConflictKey>;
  readonly usedTxnIds: ReadonlySet<string>;
};

export function greedyPickNonConflicting(params: {
  readonly candidates: readonly CandidateOp[];
  readonly maxOps: number;
  readonly getKeys: (op: CandidateOp) => readonly ConflictKey[];
  readonly usedKeys?: Iterable<ConflictKey> | undefined;
  readonly usedTxnIds?: Iterable<string> | undefined;
}): SchedulerPickResult {
  const maxOps = Math.max(0, Math.floor(params.maxOps));
  const usedKeys = new Set<ConflictKey>(params.usedKeys ?? []);
  const usedTxnIds = new Set<string>(params.usedTxnIds ?? []);

  const selected: CandidateOp[] = [];
  let skipped = 0;

  for (const op of params.candidates) {
    if (selected.length >= maxOps) break;
    const txnId = typeof op?.txn_id === 'string' ? op.txn_id : '';
    if (txnId && usedTxnIds.has(txnId)) {
      skipped += 1;
      continue;
    }

    const keys = params.getKeys(op);
    let blocked = false;
    for (const k of keys) {
      if (usedKeys.has(k)) {
        blocked = true;
        break;
      }
    }
    if (blocked) {
      skipped += 1;
      continue;
    }

    selected.push(op);
    if (txnId) usedTxnIds.add(txnId);
    for (const k of keys) usedKeys.add(k);
  }

  return { selected, skipped, usedKeys, usedTxnIds };
}
