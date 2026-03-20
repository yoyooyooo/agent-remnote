import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: rem create selection source', () => {
  it('fails fast when --from-selection is mixed with --text', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--from-selection',
      '--standalone',
      '--text',
      'hello',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(String(env.error?.message ?? '')).toContain('--from-selection');
  });

  it('dry-run compiles --from-selection as targets[] and supports --leave-portal-in-place', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-selection-create-'));
    const dbPath = path.join(tmpDir, 'remnote.db');
    const statePath = path.join(tmpDir, 'ws.bridge.state.json');
    const now = Date.now();

    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE quanta (
          _id TEXT PRIMARY KEY,
          doc TEXT NOT NULL
        );
      `);
      const insert = db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)');
      insert.run('ROOT', JSON.stringify({ _id: 'ROOT', key: ['Root'], parent: 'PAGE', f: '0' }));
      insert.run('A', JSON.stringify({ _id: 'A', key: ['A'], parent: 'ROOT', f: '1' }));
      insert.run('B', JSON.stringify({ _id: 'B', key: ['B'], parent: 'ROOT', f: '2' }));

      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            updatedAt: now,
            activeWorkerConnId: 'c1',
            clients: [
              {
                connId: 'c1',
                isActiveWorker: true,
                selection: {
                  kind: 'rem',
                  selectionType: 'Rem',
                  totalCount: 2,
                  truncated: false,
                  remIds: ['A', 'B'],
                  updatedAt: now,
                },
                uiContext: { updatedAt: now },
              },
            ],
          },
          null,
          2,
        ),
      );

      const res = await runCli(
        [
          '--json',
          '--remnote-db',
          dbPath,
          'rem',
          'create',
          '--from-selection',
          '--standalone',
          '--title',
          'Bundle',
          '--leave-portal-in-place',
          '--dry-run',
        ],
        { env: { REMNOTE_WS_STATE_FILE: statePath, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);
      expect(env.data?.ops).toEqual([
        {
          type: 'create_rem',
          payload: {
            text: 'Bundle',
            standalone: true,
            client_temp_id: env.data.alias_map.durable_target,
          },
        },
        {
          type: 'move_rem',
          payload: {
            rem_id: 'A',
            new_parent_id: env.data.alias_map.durable_target,
          },
        },
        {
          type: 'move_rem',
          payload: {
            rem_id: 'B',
            new_parent_id: env.data.alias_map.durable_target,
          },
        },
        {
          type: 'create_portal',
          payload: {
            parent_id: 'ROOT',
            position: 0,
            target_rem_id: env.data.alias_map.durable_target,
            client_temp_id: env.data.alias_map.portal_rem,
          },
        },
      ]);
    } finally {
      db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails fast when --from-selection resolves to a non-contiguous block', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-selection-invalid-'));
    const dbPath = path.join(tmpDir, 'remnote.db');
    const statePath = path.join(tmpDir, 'ws.bridge.state.json');
    const now = Date.now();

    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE quanta (
          _id TEXT PRIMARY KEY,
          doc TEXT NOT NULL
        );
      `);
      const insert = db.prepare('INSERT INTO quanta (_id, doc) VALUES (?, ?)');
      insert.run('ROOT', JSON.stringify({ _id: 'ROOT', key: ['Root'], parent: 'PAGE', f: '0' }));
      insert.run('A', JSON.stringify({ _id: 'A', key: ['A'], parent: 'ROOT', f: '1' }));
      insert.run('B_MID', JSON.stringify({ _id: 'B_MID', key: ['B mid'], parent: 'ROOT', f: '2' }));
      insert.run('C', JSON.stringify({ _id: 'C', key: ['C'], parent: 'ROOT', f: '3' }));

      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            updatedAt: now,
            activeWorkerConnId: 'c1',
            clients: [
              {
                connId: 'c1',
                isActiveWorker: true,
                selection: {
                  kind: 'rem',
                  selectionType: 'Rem',
                  totalCount: 2,
                  truncated: false,
                  remIds: ['A', 'C'],
                  updatedAt: now,
                },
                uiContext: { updatedAt: now },
              },
            ],
          },
          null,
          2,
        ),
      );

      const res = await runCli(
        [
          '--json',
          '--remnote-db',
          dbPath,
          'rem',
          'create',
          '--from-selection',
          '--standalone',
          '--title',
          'Bundle',
          '--dry-run',
        ],
        { env: { REMNOTE_WS_STATE_FILE: statePath, REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(2);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(false);
      expect(env.error?.code).toBe('INVALID_ARGS');
      expect(String(env.error?.message ?? '')).toContain('contiguous');
    } finally {
      db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
