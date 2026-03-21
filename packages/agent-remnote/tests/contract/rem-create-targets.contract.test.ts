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

describe('cli contract: rem create explicit targets', () => {
  it('dry-run compiles explicit targets into create destination plus move_rem ops', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--at',
      'standalone',
      '--is-document',
      '--title',
      'Reading Pack',
      '--from',
      'id:r1',
      '--from',
      'id:r2',
      '--portal',
      'at:parent:id:p1',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.dry_run).toBe(true);
    expect(env.data?.kind).toBe('actions');
    expect(typeof env.data?.alias_map?.durable_target).toBe('string');

    expect(env.data.ops).toEqual([
      {
        type: 'create_rem',
        payload: {
          text: 'Reading Pack',
          standalone: true,
          is_document: true,
          client_temp_id: env.data.alias_map.durable_target,
        },
      },
      {
        type: 'move_rem',
        payload: {
          rem_id: 'r1',
          new_parent_id: env.data.alias_map.durable_target,
        },
      },
      {
        type: 'move_rem',
        payload: {
          rem_id: 'r2',
          new_parent_id: env.data.alias_map.durable_target,
        },
      },
      {
        type: 'create_portal',
        payload: {
          parent_id: 'p1',
          target_rem_id: env.data.alias_map.durable_target,
          client_temp_id: env.data.alias_map.portal_rem,
        },
      },
    ]);
  });

  it('fails fast when multiple explicit targets omit --title', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--at',
      'standalone',
      '--from',
      'id:r1',
      '--from',
      'id:r2',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(String(env.error?.message ?? '')).toContain('--title');
  });

  it('infers destination title from a single explicit target when local db metadata is available', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-target-title-'));
    const dbPath = path.join(tmpDir, 'remnote.db');
    const db = new Database(dbPath);

    try {
      db.exec(`
        CREATE TABLE remsSearchInfos (
          id TEXT PRIMARY KEY,
          doc TEXT NOT NULL
        );
      `);
      db.prepare(`INSERT INTO remsSearchInfos (id, doc) VALUES (?, ?)`).run(
        'r1',
        JSON.stringify({
          kt: 'Source Rem Title',
          ke: null,
          r: 'Source Rem Title',
        }),
      );

      const res = await runCli([
        '--json',
        '--remnote-db',
        dbPath,
        'rem',
        'create',
        '--at',
        'standalone',
        '--from',
        'id:r1',
        '--dry-run',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);
      expect(env.data?.ops?.[0]?.type).toBe('create_rem');
      expect(env.data?.ops?.[0]?.payload?.text).toBe('Source Rem Title');
    } finally {
      db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
