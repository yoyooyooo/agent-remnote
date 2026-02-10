import { describe, expect, it } from 'vitest';

import { greedyPickNonConflicting } from '../../src/kernel/conflicts/index.js';

describe('conflict scheduler: greedyPickNonConflicting', () => {
  it('picks a non-overlapping subset and reports skipped', () => {
    const candidates = [
      { op_id: 'op-1', txn_id: 't1', op_type: 'x', payload: null },
      { op_id: 'op-2', txn_id: 't2', op_type: 'x', payload: null },
      { op_id: 'op-3', txn_id: 't3', op_type: 'x', payload: null },
    ] as const;

    const res = greedyPickNonConflicting({
      candidates,
      maxOps: 2,
      getKeys: (op) => {
        if (op.op_id === 'op-1') return ['k1'];
        if (op.op_id === 'op-2') return ['k1']; // conflicts with op-1
        return ['k2'];
      },
    });

    expect(res.selected.map((o) => o.op_id)).toEqual(['op-1', 'op-3']);
    expect(res.skipped).toBe(1);
  });

  it('honors usedKeys and usedTxnIds', () => {
    const candidates = [
      { op_id: 'op-1', txn_id: 't1', op_type: 'x', payload: null },
      { op_id: 'op-2', txn_id: 't1', op_type: 'x', payload: null }, // same txn => should be skipped
      { op_id: 'op-3', txn_id: 't3', op_type: 'x', payload: null },
    ] as const;

    const res = greedyPickNonConflicting({
      candidates,
      maxOps: 3,
      usedKeys: ['k1'],
      usedTxnIds: ['t1'],
      getKeys: (op) => {
        if (op.op_id === 'op-3') return ['k2'];
        return ['k1'];
      },
    });

    expect(res.selected.map((o) => o.op_id)).toEqual(['op-3']);
    expect(res.skipped).toBe(2);
  });
});

