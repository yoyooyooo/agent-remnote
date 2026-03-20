import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { ackSuccess, claimNextOp, openQueueDb, upsertIdMap } from '../../src/internal/queue/index.js';
import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForClaimAndAck(params: {
  readonly storeDb: string;
  readonly timeoutMs: number;
  readonly lockedBy: string;
  readonly clientTempId?: string;
  readonly publishMapping?: boolean;
}): Promise<void> {
  const startedAt = Date.now();
  let lastObservation = 'queue not initialized yet';
  let observedTxnId = '';

  while (Date.now() - startedAt < params.timeoutMs) {
    try {
      const db = openQueueDb(params.storeDb);
      try {
        const txn = (
          observedTxnId
            ? db.prepare(`SELECT txn_id, status FROM queue_txns WHERE txn_id = ?`).get(observedTxnId)
            : db.prepare(`SELECT txn_id, status FROM queue_txns ORDER BY created_at DESC LIMIT 1`).get()
        ) as { readonly txn_id?: string; readonly status?: string } | undefined;

        if (typeof txn?.txn_id === 'string' && txn.txn_id.trim()) {
          observedTxnId = txn.txn_id;
        }

        const op = (observedTxnId
          ? db
              .prepare(
                `SELECT op_id, status, attempt_id, locked_by, attempt_count, payload_json
                 FROM queue_ops
                 WHERE txn_id = ?
                 ORDER BY op_seq ASC
                 LIMIT 1`,
              )
              .get(observedTxnId)
          : undefined) as
          | {
              readonly op_id?: string;
              readonly status?: string;
              readonly attempt_id?: string | null;
              readonly locked_by?: string | null;
              readonly attempt_count?: number;
              readonly payload_json?: string | null;
            }
          | undefined;

        if (txn?.status === 'succeeded' && op?.status === 'succeeded') {
          return;
        }

        if (op?.status === 'in_flight' && op.op_id && op.attempt_id && op.locked_by) {
          const payload = op.payload_json ? JSON.parse(op.payload_json) : {};
          const clientTempId =
            typeof params.clientTempId === 'string' && params.clientTempId.trim()
              ? params.clientTempId.trim()
              : typeof payload?.client_temp_id === 'string'
              ? payload.client_temp_id
              : typeof payload?.clientTempId === 'string'
                ? payload.clientTempId
                : '';
          if (clientTempId && params.publishMapping !== false) {
            upsertIdMap(db as any, [
              {
                client_temp_id: clientTempId,
                remote_id: `RID-${clientTempId.slice(-6)}`,
                remote_type: 'rem',
                source_txn: typeof txn?.txn_id === 'string' ? txn.txn_id : undefined,
              },
            ]);
          }
          const ack = ackSuccess(db as any, {
            opId: String(op.op_id),
            attemptId: String(op.attempt_id),
            lockedBy: String(op.locked_by),
            result: clientTempId && params.publishMapping !== false
              ? {
                  ok: true,
                  id_map: [{ client_temp_id: clientTempId, remote_id: `RID-${clientTempId.slice(-6)}`, remote_type: 'rem' }],
                }
              : { ok: true },
          });
          if (ack.ok) {
            return;
          }

          lastObservation = `ack_existing_failed:${JSON.stringify(ack)}`;
          await sleep(50);
          continue;
        }

        const claimed = claimNextOp(db as any, params.lockedBy, 30_000);
        if (!claimed) {
          lastObservation = JSON.stringify({
            txn_id: observedTxnId || txn?.txn_id || null,
            txn_status: txn?.status ?? null,
            op_id: op?.op_id ?? null,
            op_status: op?.status ?? null,
            op_attempt_id: op?.attempt_id ?? null,
            op_locked_by: op?.locked_by ?? null,
            op_attempt_count: op?.attempt_count ?? null,
          });
          await sleep(50);
          continue;
        }

        const opId = String(claimed.op_id);
        const attemptId = String(claimed.attempt_id);
        const payload = claimed.payload_json ? JSON.parse(String(claimed.payload_json)) : {};
        const clientTempId =
          typeof params.clientTempId === 'string' && params.clientTempId.trim()
            ? params.clientTempId.trim()
            : typeof payload?.client_temp_id === 'string'
              ? payload.client_temp_id
              : typeof payload?.clientTempId === 'string'
                ? payload.clientTempId
                : '';
        if (clientTempId && params.publishMapping !== false) {
          upsertIdMap(db as any, [
            {
              client_temp_id: clientTempId,
              remote_id: `RID-${clientTempId.slice(-6)}`,
              remote_type: 'rem',
              source_txn: typeof claimed?.txn_id === 'string' ? claimed.txn_id : typeof txn?.txn_id === 'string' ? txn.txn_id : undefined,
            },
          ]);
        }
        const ack = ackSuccess(db as any, {
          opId,
          attemptId,
          lockedBy: params.lockedBy,
          result:
            clientTempId && params.publishMapping !== false
              ? {
                  ok: true,
                  id_map: [{ client_temp_id: clientTempId, remote_id: `RID-${clientTempId.slice(-6)}`, remote_type: 'rem' }],
                }
              : { ok: true },
        });
        if (!ack.ok) {
          throw new Error(`ack failed: ${JSON.stringify(ack)}`);
        }
        return;
      } finally {
        db.close();
      }
    } catch (error) {
      lastObservation = error instanceof Error ? error.message : String(error);
      await sleep(50);
    }
  }

  throw new Error(`Timed out waiting for a claimable op (${params.timeoutMs}ms). Last observation: ${lastObservation}`);
}

describe('cli contract: write --wait', () => {
  it('can wait until the txn is completed (simulated ack)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      await fs.mkdir(tmpHome, { recursive: true });

      const cliPromise = runCli(
        [
          '--json',
          'apply',
          '--payload',
          '{"version":1,"kind":"ops","ops":[{"type":"delete_rem","payload":{"rem_id":"dummy-rem"}}]}',
          '--no-notify',
          '--no-ensure-daemon',
          '--wait',
          '--timeout-ms',
          '60000',
          '--poll-ms',
          '25',
        ],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 90_000 },
      );

      await waitForClaimAndAck({ storeDb, timeoutMs: 45_000, lockedBy: 'test-conn' });

      const res = await cliPromise;
      if (res.exitCode !== 0) {
        throw new Error(`CLI exited with ${res.exitCode}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
      }
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);

      const data = env.data as any;
      expect(typeof data.txn_id).toBe('string');
      expect(Array.isArray(data.op_ids)).toBe(true);
      expect(data.status).toBe('succeeded');
      expect(data.is_done).toBe(true);
      expect(data.is_success).toBe(true);
      expect(Array.isArray(data.id_map)).toBe(true);
      expect(data.id_map).toEqual([]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 75_000);

  it('returns canonical id_map for rem create --wait', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      await fs.mkdir(tmpHome, { recursive: true });

      const cliPromise = runCli(
        [
          '--json',
          'rem',
          'create',
          '--parent',
          'dummy-parent',
          '--text',
          'hello',
          '--client-temp-id',
          'tmp:rem-create-test',
          '--no-notify',
          '--no-ensure-daemon',
          '--wait',
        ],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 90_000 },
      );

      await waitForClaimAndAck({
        storeDb,
        timeoutMs: 45_000,
        lockedBy: 'test-conn',
        clientTempId: 'tmp:rem-create-test',
      });

      const res = await cliPromise;
      if (res.exitCode !== 0) {
        throw new Error(`CLI exited with ${res.exitCode}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
      }

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);

      const data = env.data as any;
      expect(typeof data.rem_id).toBe('string');
      expect(data.id_map).toEqual([
        expect.objectContaining({
          client_temp_id: 'tmp:rem-create-test',
          remote_id: data.rem_id,
          remote_type: expect.any(String),
        }),
      ]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 75_000);

  it('returns canonical id_map for portal create --wait', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      await fs.mkdir(tmpHome, { recursive: true });

      const cliPromise = runCli(
        [
          '--json',
          'portal',
          'create',
          '--parent',
          'p1',
          '--target',
          't1',
          '--client-temp-id',
          'tmp:portal-create-test',
          '--no-notify',
          '--no-ensure-daemon',
          '--wait',
        ],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 90_000 },
      );

      await waitForClaimAndAck({
        storeDb,
        timeoutMs: 45_000,
        lockedBy: 'test-conn',
        clientTempId: 'tmp:portal-create-test',
      });

      const res = await cliPromise;
      if (res.exitCode !== 0) {
        throw new Error(`CLI exited with ${res.exitCode}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
      }

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);

      const data = env.data as any;
      expect(typeof data.portal_rem_id).toBe('string');
      expect(data.id_map).toEqual([
        expect.objectContaining({
          client_temp_id: 'tmp:portal-create-test',
          remote_id: data.portal_rem_id,
          remote_type: expect.any(String),
        }),
      ]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 75_000);

  it('times out with a stable error.code in --json mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const res = await runCli(
        [
          '--json',
          'apply',
          '--payload',
          '{"version":1,"kind":"ops","ops":[{"type":"delete_rem","payload":{"rem_id":"dummy-rem"}}]}',
          '--no-notify',
          '--no-ensure-daemon',
          '--wait',
          '--timeout-ms',
          '50',
          '--poll-ms',
          '10',
        ],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(false);
      expect(env.error?.code).toBe('TXN_TIMEOUT');
      expect(Array.isArray(env.hint)).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails with TXN_TIMEOUT when required id_map entries never become durable', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      await fs.mkdir(tmpHome, { recursive: true });

      const cliPromise = runCli(
        [
          '--json',
          'rem',
          'create',
          '--parent',
          'dummy-parent',
          '--text',
          'hello',
          '--client-temp-id',
          'tmp:missing-id-map-test',
          '--no-notify',
          '--no-ensure-daemon',
          '--wait',
          '--timeout-ms',
          '250',
          '--poll-ms',
          '25',
        ],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
      );

      await waitForClaimAndAck({
        storeDb,
        timeoutMs: 45_000,
        lockedBy: 'test-conn',
        clientTempId: 'tmp:missing-id-map-test',
        publishMapping: false,
      });

      const res = await cliPromise;
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(false);
      expect(env.error?.code).toBe('TXN_TIMEOUT');
      expect(String(env.error?.message ?? '')).toContain('id_map');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
