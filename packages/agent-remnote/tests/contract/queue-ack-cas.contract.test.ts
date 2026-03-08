import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { ackRetry, ackSuccess, claimNextOp, enqueueTxn, openQueueDb } from '../../src/internal/queue/index.js';

describe('queue contract: ack is CAS by attempt_id', () => {
  it('rejects stale ack and does not roll back terminal status', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-queue-ack-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        const txnId = enqueueTxn(db, [{ type: 'create_rem', payload: { parentId: 'dummy', text: 'hello' } }]);
        expect(typeof txnId).toBe('string');

        const claimed = claimNextOp(db, 'conn-1', 30_000);
        expect(claimed).not.toBeNull();
        const opId = String(claimed!.op_id);
        const attemptId = String(claimed!.attempt_id);
        expect(attemptId.length).toBeGreaterThan(0);

        // Wrong attempt_id => rejected.
        const stale = ackSuccess(db, { opId, attemptId: 'wrong-attempt', lockedBy: 'conn-1', result: { ok: true } });
        expect(stale.ok).toBe(false);
        if (stale.ok) throw new Error('expected invalid_attempt');
        expect(stale.reason).toBe('invalid_attempt');

        const row1 = db.prepare(`SELECT status, attempt_id FROM queue_ops WHERE op_id=?`).get(opId) as any;
        expect(String(row1.status)).toBe('in_flight');
        expect(String(row1.attempt_id)).toBe(attemptId);

        // Correct attempt_id but wrong conn => stale_ack (CAS mismatch), no state change.
        const wrongConn = ackSuccess(db, { opId, attemptId, lockedBy: 'conn-2', result: { ok: true } });
        expect(wrongConn.ok).toBe(false);
        if (wrongConn.ok) throw new Error('expected stale_ack');
        expect(wrongConn.reason).toBe('stale_ack');

        // Correct ack => succeeded.
        const ok = ackSuccess(db, { opId, attemptId, lockedBy: 'conn-1', result: { ok: true } });
        expect(ok.ok).toBe(true);
        if (!ok.ok) throw new Error('expected AckOk');
        expect(ok.duplicate).toBe(false);

        // Duplicate ack => AckOk semantics.
        const dup = ackSuccess(db, { opId, attemptId, lockedBy: 'conn-1', result: { ok: true } });
        expect(dup.ok).toBe(true);
        if (!dup.ok) throw new Error('expected AckOk (duplicate)');
        expect(dup.duplicate).toBe(true);

        const row2 = db
          .prepare(`SELECT status, locked_at, lease_expires_at FROM queue_ops WHERE op_id=?`)
          .get(opId) as any;
        expect(String(row2.status)).toBe('succeeded');
        expect(row2.locked_at).toBeNull();
        expect(row2.lease_expires_at).toBeNull();

        // Stale retry must not roll back a terminal op.
        const retry = ackRetry(db, {
          opId,
          attemptId,
          lockedBy: 'conn-1',
          error: { code: 'EXEC_ERROR', message: 'late' },
        });
        expect(retry.ok).toBe(false);
        if (retry.ok) throw new Error('expected stale_ack');
        expect(retry.reason).toBe('stale_ack');

        const row3 = db.prepare(`SELECT status FROM queue_ops WHERE op_id=?`).get(opId) as any;
        expect(String(row3.status)).toBe('succeeded');
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
