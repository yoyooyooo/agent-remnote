import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { claimNextOp, enqueueTxn, openQueueDb } from '../../src/internal/queue/index.js';
import { handleOpAckMessage } from '../../src/lib/wsBridgeCoreAck.js';

describe('backup registry', () => {
  it('records retained visible backups on successful replace ack', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-backup-registry-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        const txnId = enqueueTxn(db, [
          {
            type: 'replace_children_with_markdown',
            payload: {
              parent_id: 'parent-1',
              markdown: '- Report',
              backup: 'visible',
              assertions: ['single-root'],
            },
          },
        ]);

        const claimed = claimNextOp(db, 'conn-1', 30_000);
        expect(claimed).not.toBeNull();

        const res = handleOpAckMessage({
          now: Date.now(),
          db,
          connId: 'conn-1',
          msg: {
            type: 'OpAck',
            op_id: claimed!.op_id,
            attempt_id: claimed!.attempt_id,
            status: 'success',
            result: {
              ok: true,
              parent_id: 'parent-1',
              backup_deleted: false,
              backup_rem_id: 'backup-rem-1',
            },
          },
        });

        expect(res.actions.some((action) => action._tag === 'SendJson')).toBe(true);

        const row = db.prepare(`SELECT * FROM backup_artifacts WHERE source_txn=?`).get(txnId) as any;
        expect(row).toBeTruthy();
        expect(row.backup_kind).toBe('children_replace');
        expect(row.cleanup_policy).toBe('visible');
        expect(row.cleanup_state).toBe('retained');
        expect(row.backup_rem_id).toBe('backup-rem-1');
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('records orphan backups when auto-cleanup replace fails after leaving a backup rem', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-backup-registry-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        const txnId = enqueueTxn(db, [
          {
            type: 'replace_selection_with_markdown',
            payload: {
              markdown: '- Report',
              target: { mode: 'explicit', rem_ids: ['rem-1'] },
            },
          },
        ]);

        const claimed = claimNextOp(db, 'conn-1', 30_000);
        expect(claimed).not.toBeNull();

        handleOpAckMessage({
          now: Date.now(),
          db,
          connId: 'conn-1',
          msg: {
            type: 'OpAck',
            op_id: claimed!.op_id,
            attempt_id: claimed!.attempt_id,
            status: 'failed',
            error_code: 'EXEC_ERROR',
            error_message: 'Failed to delete backup',
            result: {
              backup_deleted: false,
              backup_rem_id: 'backup-rem-orphan',
            },
          },
        });

        const row = db.prepare(`SELECT * FROM backup_artifacts WHERE source_txn=?`).get(txnId) as any;
        expect(row).toBeTruthy();
        expect(row.backup_kind).toBe('selection_replace');
        expect(row.cleanup_policy).toBe('auto');
        expect(row.cleanup_state).toBe('orphan');
        expect(row.backup_rem_id).toBe('backup-rem-orphan');
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('records hidden deferred backups as pending after successful replace ack', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-backup-registry-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        const txnId = enqueueTxn(db, [
          {
            type: 'replace_children_with_markdown',
            payload: {
              parent_id: 'parent-1',
              markdown: '- Report',
            },
          },
        ]);

        const claimed = claimNextOp(db, 'conn-1', 30_000);
        expect(claimed).not.toBeNull();

        handleOpAckMessage({
          now: Date.now(),
          db,
          connId: 'conn-1',
          msg: {
            type: 'OpAck',
            op_id: claimed!.op_id,
            attempt_id: claimed!.attempt_id,
            status: 'success',
            result: {
              ok: true,
              parent_id: 'parent-1',
              backup_deleted: false,
              backup_rem_id: 'backup-rem-hidden',
              backup_policy: 'none',
              backup_hidden: true,
            },
          },
        });

        const row = db.prepare(`SELECT * FROM backup_artifacts WHERE source_txn=?`).get(txnId) as any;
        expect(row).toBeTruthy();
        expect(row.cleanup_policy).toBe('auto');
        expect(row.cleanup_state).toBe('pending');
        expect(row.backup_rem_id).toBe('backup-rem-hidden');
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not sync backup artifacts for rejected/stale ack statuses', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-backup-registry-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        const txnId = enqueueTxn(db, [
          {
            type: 'replace_children_with_markdown',
            payload: {
              parent_id: 'parent-1',
              markdown: '- Report',
            },
          },
        ]);

        const claimed = claimNextOp(db, 'conn-1', 30_000);
        expect(claimed).not.toBeNull();

        handleOpAckMessage({
          now: Date.now(),
          db,
          connId: 'conn-1',
          msg: {
            type: 'OpAck',
            op_id: claimed!.op_id,
            attempt_id: claimed!.attempt_id,
            status: 'weird_status',
            result: {
              backup_deleted: false,
              backup_rem_id: 'backup-rem-should-not-sync',
            },
          },
        });

        const row = db.prepare(`SELECT * FROM backup_artifacts WHERE source_txn=?`).get(txnId) as any;
        expect(row).toBeUndefined();
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not regress backup registry state on duplicate success ack', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-backup-registry-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    try {
      const db = openQueueDb(dbPath);
      try {
        const txnId = enqueueTxn(db, [
          {
            type: 'replace_children_with_markdown',
            payload: {
              parent_id: 'parent-1',
              markdown: '- Report',
              backup: 'visible',
            },
          },
        ]);

        const claimed = claimNextOp(db, 'conn-1', 30_000);
        expect(claimed).not.toBeNull();

        handleOpAckMessage({
          now: Date.now(),
          db,
          connId: 'conn-1',
          msg: {
            type: 'OpAck',
            op_id: claimed!.op_id,
            attempt_id: claimed!.attempt_id,
            status: 'success',
            result: {
              ok: true,
              parent_id: 'parent-1',
              backup_deleted: false,
              backup_rem_id: 'backup-rem-dup',
            },
          },
        });

        db.prepare(`UPDATE backup_artifacts SET cleanup_state='cleaned', cleaned_at=123 WHERE source_txn=?`).run(txnId);

        handleOpAckMessage({
          now: Date.now() + 1_000,
          db,
          connId: 'conn-1',
          msg: {
            type: 'OpAck',
            op_id: claimed!.op_id,
            attempt_id: claimed!.attempt_id,
            status: 'success',
            result: {
              ok: true,
              parent_id: 'parent-1',
              backup_deleted: false,
              backup_rem_id: 'backup-rem-dup',
            },
          },
        });

        const row = db.prepare(`SELECT cleanup_state, cleaned_at FROM backup_artifacts WHERE source_txn=?`).get(txnId) as any;
        expect(row.cleanup_state).toBe('cleaned');
        expect(row.cleaned_at).toBe(123);
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
