import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ackDead, ackSuccess, claimNextOp, openQueueDb, upsertIdMap } from '../../src/internal/queue/index.js';
import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCreatePortalPartialFailure(params: {
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

        const payload = claimed.payload_json ? JSON.parse(String(claimed.payload_json)) : {};
        const clientTempId =
          typeof payload?.client_temp_id === 'string'
            ? payload.client_temp_id
            : typeof payload?.clientTempId === 'string'
              ? payload.clientTempId
              : '';

        if (claimed.type === 'create_portal') {
          const ack = ackDead(db as any, {
            opId: String(claimed.op_id),
            attemptId: String(claimed.attempt_id),
            lockedBy: params.lockedBy,
            error: { code: 'PORTAL_FAILED', message: 'portal insertion failed in test' },
          });
          if (!ack.ok) throw new Error(`ackDead failed: ${JSON.stringify(ack)}`);
          return;
        }

        if (clientTempId) {
          upsertIdMap(db as any, [
            {
              client_temp_id: clientTempId,
              remote_id: `RID-${clientTempId.slice(-6)}`,
              remote_type: 'rem',
              source_txn: String(claimed.txn_id),
            },
          ]);
        }

        const ack = ackSuccess(db as any, {
          opId: String(claimed.op_id),
          attemptId: String(claimed.attempt_id),
          lockedBy: params.lockedBy,
          result:
            clientTempId
              ? {
                  ok: true,
                  id_map: [
                    {
                      client_temp_id: clientTempId,
                      remote_id: `RID-${clientTempId.slice(-6)}`,
                      remote_type: 'rem',
                    },
                  ],
                }
              : { ok: true },
        });
        if (!ack.ok) throw new Error(`ackSuccess failed: ${JSON.stringify(ack)}`);
      } finally {
        db.close();
      }
    } catch {
      await sleep(50);
    }
  }

  throw new Error(`Timed out waiting for partial-failure ack sequence (${params.timeoutMs}ms)`);
}

describe('cli contract: rem create promotion', () => {
  it('dry-run compiles standalone markdown create with optional portal placement', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--standalone',
      '--is-document',
      '--title',
      'LangGraph',
      '--markdown',
      '- Overview\n  - StateGraph',
      '--portal-parent',
      'p1',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(env.data?.kind).toBe('actions');
    expect(Array.isArray(env.data?.ops)).toBe(true);
    expect(typeof env.data?.alias_map?.durable_target).toBe('string');

    const [createOp, markdownOp, portalOp] = env.data.ops;
    expect(createOp.type).toBe('create_rem');
    expect(createOp.payload.text).toBe('LangGraph');
    expect(createOp.payload.is_document).toBe(true);
    expect(createOp.payload.standalone).toBe(true);
    expect(createOp.payload.client_temp_id).toBe(env.data.alias_map.durable_target);

    expect(markdownOp.type).toBe('create_tree_with_markdown');
    expect(markdownOp.payload.parent_id).toBe(env.data.alias_map.durable_target);
    expect(markdownOp.payload.markdown).toBe('- Overview\n  - StateGraph');

    expect(portalOp.type).toBe('create_portal');
    expect(portalOp.payload.parent_id).toBe('p1');
    expect(portalOp.payload.target_rem_id).toBe(env.data.alias_map.durable_target);
  });

  it('fails fast when --markdown omits --title', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--standalone',
      '--markdown',
      '- Overview',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(String(env.error?.message ?? '')).toContain('--title');
  });

  it('resolves --before and --portal-after into parent-relative positions using anchor layout', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-anchor-create-'));
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
      insert.run('ANCHOR_BEFORE', JSON.stringify({ _id: 'ANCHOR_BEFORE', key: ['Anchor'], parent: 'PARENT', f: 'c' }));
      insert.run('P1', JSON.stringify({ _id: 'P1', key: ['P1'], parent: 'PORTAL_PARENT', f: 'a' }));
      insert.run('P2', JSON.stringify({ _id: 'P2', key: ['P2'], parent: 'PORTAL_PARENT', f: 'b' }));
      insert.run('P3', JSON.stringify({ _id: 'P3', key: ['P3'], parent: 'PORTAL_PARENT', f: 'c' }));
      insert.run('P4', JSON.stringify({ _id: 'P4', key: ['P4'], parent: 'PORTAL_PARENT', f: 'd' }));
      insert.run('ANCHOR_PORTAL', JSON.stringify({ _id: 'ANCHOR_PORTAL', key: ['Portal Anchor'], parent: 'PORTAL_PARENT', f: 'e' }));

      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'rem',
        'create',
        '--before',
        'ANCHOR_BEFORE',
        '--title',
        'Anchor Create',
        '--markdown',
        '- child',
        '--portal-after',
        'ANCHOR_PORTAL',
        '--dry-run',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);
      expect(env.data.ops[0]).toEqual({
        type: 'create_rem',
        payload: {
          parent_id: 'PARENT',
          position: 2,
          text: 'Anchor Create',
          client_temp_id: env.data.alias_map.durable_target,
        },
      });
      expect(env.data.ops[2]).toEqual({
        type: 'create_portal',
        payload: {
          parent_id: 'PORTAL_PARENT',
          position: 5,
          target_rem_id: env.data.alias_map.durable_target,
          client_temp_id: env.data.alias_map.portal_rem,
        },
      });
    } finally {
      db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns partial-success receipt when durable target exists but portal insertion fails', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-partial-create-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      await fs.mkdir(tmpHome, { recursive: true });

      const cliPromise = runCli(
        [
          '--json',
          'rem',
          'create',
          '--standalone',
          '--title',
          'Partial Create',
          '--markdown',
          '- child',
          '--portal-parent',
          'p1',
          '--no-notify',
          '--no-ensure-daemon',
          '--wait',
        ],
        { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 90_000 },
      );

      await waitForCreatePortalPartialFailure({ storeDb, timeoutMs: 45_000, lockedBy: 'test-conn' });

      const res = await cliPromise;
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);
      expect(env.data?.partial_success).toBe(true);
      expect(typeof env.data?.durable_target?.rem_id).toBe('string');
      expect(env.data?.portal).toEqual(
        expect.objectContaining({
          requested: true,
          created: false,
        }),
      );
      expect(Array.isArray(env.data?.warnings)).toBe(true);
      expect(String(env.data?.warnings?.join(' '))).toContain('portal insertion failed');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 75_000);
});
