import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ackSuccess, claimNextOp, openQueueDb } from '../../src/internal/queue/index.js';
import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMovePartialSuccess(params: {
  readonly storeDb: string;
  readonly timeoutMs: number;
  readonly lockedBy: string;
}): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < params.timeoutMs) {
    try {
      const db = openQueueDb(params.storeDb);
      try {
        const claimed = claimNextOp(db as any, params.lockedBy, 30_000);
        if (!claimed) {
          await sleep(50);
          continue;
        }

        const ack = ackSuccess(db as any, {
          opId: String(claimed.op_id),
          attemptId: String(claimed.attempt_id),
          lockedBy: params.lockedBy,
          result: {
            ok: true,
            rem_id: 'r1',
            standalone: true,
            leave_portal: true,
            portal_created: false,
            warnings: ['leave-portal failed in test'],
            nextActions: ['agent-remnote --json portal create --parent p1 --target r1'],
            source_parent_id: 'p1',
          },
        });
        if (!ack.ok) throw new Error(`ackSuccess failed: ${JSON.stringify(ack)}`);
        return;
      } finally {
        db.close();
      }
    } catch {
      await sleep(50);
    }
  }

  throw new Error(`Timed out waiting for move partial-success ack (${params.timeoutMs}ms)`);
}

describe('cli contract: rem move promotion', () => {
  it('dry-run compiles standalone promotion with leave-portal and explicit document flag', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'move',
      '--rem',
      'r1',
      '--standalone',
      '--is-document',
      '--leave-portal',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(env.data?.kind).toBe('actions');
    expect(env.data?.ops).toEqual([
      {
        type: 'move_rem',
        payload: {
          rem_id: 'r1',
          standalone: true,
          is_document: true,
          leave_portal: true,
        },
      },
    ]);
  });

  it('fails fast when multiple destination placement groups are combined', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'move',
      '--rem',
      'r1',
      '--parent',
      'p1',
      '--standalone',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(String(env.error?.message ?? '')).toContain('placement');
  });

  it('resolves --after anchor placement into parent-relative move_rem coordinates', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-anchor-move-'));
    const dbPath = path.join(tmpDir, 'remnote.db');
    const db = new Database(dbPath);

    try {
      db.exec(`
        CREATE TABLE quanta (
          _id TEXT PRIMARY KEY,
          doc TEXT NOT NULL
        );
      `);
      const insert = db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)');
      insert.run('S1', JSON.stringify({ _id: 'S1', key: ['S1'], parent: 'PARENT', f: 'a' }));
      insert.run('S2', JSON.stringify({ _id: 'S2', key: ['S2'], parent: 'PARENT', f: 'b' }));
      insert.run('S3', JSON.stringify({ _id: 'S3', key: ['S3'], parent: 'PARENT', f: 'c' }));
      insert.run('S4', JSON.stringify({ _id: 'S4', key: ['S4'], parent: 'PARENT', f: 'd' }));
      insert.run('S5', JSON.stringify({ _id: 'S5', key: ['S5'], parent: 'PARENT', f: 'e' }));
      insert.run('S6', JSON.stringify({ _id: 'S6', key: ['S6'], parent: 'PARENT', f: 'f' }));
      insert.run('S7', JSON.stringify({ _id: 'S7', key: ['S7'], parent: 'PARENT', f: 'g' }));
      insert.run('ANCHOR_AFTER', JSON.stringify({ _id: 'ANCHOR_AFTER', key: ['Anchor'], parent: 'PARENT', f: 'h' }));

      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'rem',
        'move',
        '--rem',
        'r1',
        '--after',
        'ANCHOR_AFTER',
        '--dry-run',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);
      expect(env.data?.ops).toEqual([
        {
          type: 'move_rem',
          payload: {
            rem_id: 'r1',
            new_parent_id: 'PARENT',
            position: 8,
          },
        },
      ]);
    } finally {
      db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns stable receipt when move succeeds but leave-portal fails', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-move-partial-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      await fs.mkdir(tmpHome, { recursive: true });

      const cliPromise = runCli(
        [
          '--json',
          'rem',
          'move',
          '--rem',
          'r1',
          '--standalone',
          '--leave-portal',
          '--no-notify',
          '--no-ensure-daemon',
          '--wait',
        ],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 90_000 },
      );

      await waitForMovePartialSuccess({ storeDb, timeoutMs: 45_000, lockedBy: 'test-conn' });

      const res = await cliPromise;
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);
      expect(env.data?.durable_target).toEqual({
        rem_id: 'r1',
        is_document: false,
        placement_kind: 'standalone',
      });
      expect(env.data?.portal).toEqual({
        requested: true,
        created: false,
        placement_kind: 'in_place_single_rem',
      });
      expect(env.data?.source_context).toEqual({
        source_kind: 'targets',
        source_origin: 'move_single_rem',
        parent_id: 'p1',
      });
      expect(Array.isArray(env.data?.warnings)).toBe(true);
      expect(String(env.data?.warnings?.join(' '))).toContain('leave-portal failed');
      expect(Array.isArray(env.data?.nextActions)).toBe(true);
      expect(String(env.data?.nextActions?.join(' '))).toContain('portal create');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 75_000);
});
