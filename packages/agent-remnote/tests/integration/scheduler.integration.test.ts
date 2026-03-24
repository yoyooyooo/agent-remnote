import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  claimSelectedOpsBatch,
  claimOpById,
  enqueueTxn,
  listInFlightOps,
  openQueueDb,
  peekEligibleOps,
} from '../../src/internal/queue/index.js';
import { deriveConflictKeys, greedyPickNonConflicting } from '../../src/kernel/conflicts/index.js';

function safeParseJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function isSerialTxn(dispatchMode: unknown): boolean {
  const raw = typeof dispatchMode === 'string' ? dispatchMode.trim() : '';
  return raw !== 'conflict_parallel';
}

function dispatchWithScheduler(params: {
  db: any;
  lockedBy: string;
  leaseMs: number;
  maxOps: number;
  peekLimit?: number;
}) {
  const peekLimit = Math.max(1, Math.min(500, Math.floor(params.peekLimit ?? 200)));

  const usedKeys = new Set<string>();
  const usedTxnIds = new Set<string>();
  for (const o of listInFlightOps(params.db, 500)) {
    const txnId = typeof o.txn_id === 'string' ? o.txn_id : '';
    if (txnId && isSerialTxn((o as any).txn_dispatch_mode)) usedTxnIds.add(txnId);
    const keys = deriveConflictKeys(o.type, safeParseJson(String(o.payload_json ?? '')));
    for (const k of keys) usedKeys.add(k);
  }

  const candidates = peekEligibleOps(params.db, peekLimit).map((op) => ({
    op_id: String(op.op_id),
    txn_id: String(op.txn_id),
    op_type: String(op.type),
    payload: safeParseJson(String(op.payload_json ?? '')),
  }));

  const pick = greedyPickNonConflicting({
    candidates,
    maxOps: params.maxOps,
    usedKeys,
    usedTxnIds,
    getKeys: (op) => deriveConflictKeys(op.op_type, op.payload),
  });

  const claimed: any[] = [];
  for (const op of pick.selected) {
    const row = claimOpById(params.db, op.op_id, params.lockedBy, params.leaseMs);
    if (row) claimed.push(row);
  }
  return { claimed, usedKeys };
}

function dispatchWithSchedulerBatchClaim(params: {
  db: any;
  lockedBy: string;
  leaseMs: number;
  maxOps: number;
  peekLimit?: number;
}) {
  const peekLimit = Math.max(1, Math.min(500, Math.floor(params.peekLimit ?? 200)));

  const usedKeys = new Set<string>();
  const usedTxnIds = new Set<string>();
  for (const o of listInFlightOps(params.db, 500)) {
    const txnId = typeof o.txn_id === 'string' ? o.txn_id : '';
    if (txnId && isSerialTxn((o as any).txn_dispatch_mode)) usedTxnIds.add(txnId);
    const keys = deriveConflictKeys(o.type, safeParseJson(String(o.payload_json ?? '')));
    for (const k of keys) usedKeys.add(k);
  }

  const candidates = peekEligibleOps(params.db, peekLimit).map((op) => ({
    ...op,
    op_id: String(op.op_id),
    txn_id: String(op.txn_id),
    op_type: String(op.type),
    payload: safeParseJson(String(op.payload_json ?? '')),
    leaseMs: params.leaseMs,
  }));

  const pick = greedyPickNonConflicting({
    candidates,
    maxOps: params.maxOps,
    usedKeys,
    usedTxnIds,
    getKeys: (op) => deriveConflictKeys((op as any).op_type, (op as any).payload),
  });

  const claimed = claimSelectedOpsBatch(params.db, {
    lockedBy: params.lockedBy,
    selected: pick.selected.map((op: any) => ({
      op_id: String(op.op_id),
      txn_id: String(op.txn_id),
      op_seq: Number(op.op_seq ?? 0),
      txn_dispatch_mode: (op as any).txn_dispatch_mode ?? null,
      type: String(op.type),
      payload_json: String(op.payload_json ?? ''),
      idempotency_key: (op as any).idempotency_key ?? null,
      leaseMs: Number(op.leaseMs ?? params.leaseMs),
    })),
  });

  return { claimed, usedKeys };
}

describe('scheduler integration (db + conflicts)', () => {
  it('does not dispatch ops conflicting with existing in_flight keys', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-scheduler-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        const enqueueOne = (remId: string) => {
          const txnId = enqueueTxn(db as any, [{ type: 'update_text', payload: { remId, text: 'x' } }]);
          const row = db
            .prepare(`SELECT op_id FROM queue_ops WHERE txn_id=? ORDER BY op_seq ASC LIMIT 1`)
            .get(txnId) as any;
          return { txnId, opId: String(row.op_id) };
        };

        const a1 = enqueueOne('A');
        const a2 = enqueueOne('A');
        const b1 = enqueueOne('B');
        const c1 = enqueueOne('C');
        void a2;
        void b1;
        void c1;

        const inflight = claimOpById(db as any, a1.opId, 'conn-old', 30_000);
        expect(inflight).not.toBeNull();

        const res = dispatchWithScheduler({ db, lockedBy: 'conn-new', leaseMs: 30_000, maxOps: 3 });
        expect(res.claimed.length).toBe(2);

        const used = new Set(res.usedKeys);
        const claimedKeys = new Set<string>();
        for (const row of res.claimed) {
          const payload = safeParseJson(String(row.payload_json ?? ''));
          expect(String(payload?.remId ?? payload?.rem_id ?? '')).not.toBe('A');

          const keys = deriveConflictKeys(row.type, payload);
          for (const k of keys) {
            expect(used.has(k)).toBe(false);
            expect(claimedKeys.has(k)).toBe(false);
            claimedKeys.add(k);
          }
        }
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('picks a maximal non-conflicting batch when possible', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-scheduler-2-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        const enqueueOne = (remId: string) => {
          enqueueTxn(db as any, [{ type: 'update_text', payload: { remId, text: 'x' } }]);
        };

        enqueueOne('A');
        enqueueOne('A');
        enqueueOne('B');
        enqueueOne('C');
        enqueueOne('D');

        const res = dispatchWithScheduler({ db, lockedBy: 'conn-new', leaseMs: 30_000, maxOps: 3 });
        expect(res.claimed.length).toBe(3);

        const claimedKeys = new Set<string>();
        for (const row of res.claimed) {
          const payload = safeParseJson(String(row.payload_json ?? ''));
          const keys = deriveConflictKeys(row.type, payload);
          for (const k of keys) {
            expect(claimedKeys.has(k)).toBe(false);
            claimedKeys.add(k);
          }
        }
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('allows same-txn parallel dispatch when dispatch_mode=conflict_parallel', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-scheduler-parallel-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        const txnId = enqueueTxn(
          db as any,
          [
            { type: 'update_text', payload: { rem_id: 'A', text: 'x' } },
            { type: 'update_text', payload: { rem_id: 'B', text: 'y' } },
          ],
          { dispatchMode: 'conflict_parallel' },
        );

        const ops = db.prepare(`SELECT op_id FROM queue_ops WHERE txn_id=? ORDER BY op_seq ASC`).all(txnId) as any[];
        expect(ops.length).toBe(2);
        const opA = String(ops[0]!.op_id);
        const opB = String(ops[1]!.op_id);

        const inflight = claimOpById(db as any, opA, 'conn-old', 30_000);
        expect(inflight).not.toBeNull();

        const res = dispatchWithScheduler({ db, lockedBy: 'conn-new', leaseMs: 30_000, maxOps: 1 });
        expect(res.claimed.length).toBe(1);
        expect(String(res.claimed[0]!.op_id)).toBe(opB);
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('claims a selected non-conflicting batch in one batch call', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-scheduler-batch-claim-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        const enqueueOne = (remId: string) => {
          enqueueTxn(db as any, [{ type: 'update_text', payload: { rem_id: remId, text: 'x' } }]);
        };

        enqueueOne('A');
        enqueueOne('A');
        enqueueOne('B');
        enqueueOne('C');
        enqueueOne('D');

        const firstA = db
          .prepare(`SELECT op_id FROM queue_ops WHERE json_extract(payload_json, '$.rem_id')='A' ORDER BY created_at ASC LIMIT 1`)
          .get() as any;
        const inflight = claimOpById(db as any, String(firstA.op_id), 'conn-old', 30_000);
        expect(inflight).not.toBeNull();

        const res = dispatchWithSchedulerBatchClaim({ db, lockedBy: 'conn-batch', leaseMs: 30_000, maxOps: 3 });
        expect(res.claimed.length).toBe(3);
        expect(res.claimed.every((row: any) => row.locked_by === 'conn-batch')).toBe(true);

        const claimedKeys = new Set<string>();
        for (const row of res.claimed) {
          const payload = safeParseJson(String(row.payload_json ?? ''));
          const remId = String(payload?.rem_id ?? payload?.remId ?? '');
          expect(remId).not.toBe('A');
          for (const key of deriveConflictKeys(row.type, payload)) {
            expect(claimedKeys.has(key)).toBe(false);
            claimedKeys.add(key);
          }
        }
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
