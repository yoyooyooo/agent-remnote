import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';

import { startJsonApiStub } from '../helpers/httpApiStub.js';
import { runCli } from '../helpers/runCli.js';

async function withTmpDb(fn: (dbPath: string) => Promise<void>): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-query-v2-test-'));
  const dbPath = path.join(tmpDir, 'remnote.db');
  try {
    const db = new BetterSqlite3(dbPath);
    try {
      db.exec('CREATE TABLE quanta(_id TEXT PRIMARY KEY, doc TEXT NOT NULL);');
      db.exec(
        'CREATE TABLE remsSearchInfos(id TEXT PRIMARY KEY, aliasId TEXT, doc TEXT, ancestor_not_ref_text TEXT, ancestor_ids TEXT, freqCounter INTEGER, freqTime INTEGER);',
      );

      const insert = db.prepare('INSERT INTO quanta(_id, doc) VALUES(?, ?)');
      const insertSearch = db.prepare(
        'INSERT INTO remsSearchInfos(id, aliasId, doc, ancestor_not_ref_text, ancestor_ids, freqCounter, freqTime) VALUES(?, ?, ?, ?, ?, ?, ?)',
      );

      insert.run('T1', JSON.stringify({ key: ['Todo'], rcrt: 't', createdAt: 1000 }));
      insert.run(
        'R1',
        JSON.stringify({
          key: ['Task 1'],
          tp: { T1: { t: 1 } },
          createdAt: '1700000000000',
          u: '1700000001000',
          m: '1700000000500',
        }),
      );
      insert.run(
        'R2',
        JSON.stringify({
          key: ['Task 2'],
          createdAt: '1700000000001',
          u: '1700000001001',
          m: '1700000000501',
        }),
      );
      insert.run(
        'D1',
        JSON.stringify({
          key: ['2026/03/23'],
          tp: { DAILY_DOC: { t: true } },
          createdAt: '1700000000002',
          u: '1700000001002',
          m: '1700000000502',
        }),
      );
      insert.run('DAILY_DOC', JSON.stringify({ key: ['Daily Document'], rcrt: 'd', createdAt: 1001 }));
      insertSearch.run('R1', 'R1', JSON.stringify({ kt: 'Task 1' }), null, null, 0, 0);
      insertSearch.run('R2', 'R2', JSON.stringify({ kt: 'Task 2' }), null, null, 0, 0);
      insertSearch.run('D1', 'D1', JSON.stringify({ kt: '2026/03/23' }), null, null, 0, 0);
    } finally {
      db.close();
    }

    await fn(dbPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe('cli contract: query v2 powerup predicate', () => {
  it('normalizes query --powerup into canonical query v2 before local execution', async () => {
    await withTmpDb(async (dbPath) => {
      const res = await runCli(['--json', '--remnote-db', dbPath, 'query', '--powerup', 'Todo']);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(true);
      expect(env.data.items.map((item: any) => item.id)).toEqual(['R1']);
      expect(env.data.queryUsed.version).toBe(2);
      expect(env.data.queryUsed.root).toMatchObject({
        type: 'powerup',
        powerup: { by: 'id', value: 'T1' },
      });
    });
  });

  it('accepts canonical powerup.by=rcrt payloads in query v2', async () => {
    await withTmpDb(async (dbPath) => {
      const payload = JSON.stringify({
        query: {
          version: 2,
          root: {
            type: 'powerup',
            powerup: { by: 'rcrt', value: 't' },
          },
        },
      });
      const res = await runCli(['--json', '--remnote-db', dbPath, 'query', '--payload', '-'], {
        stdin: payload,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(true);
      expect(env.data.items.map((item: any) => item.id)).toEqual(['R1']);
      expect(env.data.queryUsed.root).toMatchObject({
        type: 'powerup',
        powerup: { by: 'rcrt', value: 't' },
      });
    });
  });

  it('does not treat generic tp marker fields as a powerup rcrt match', async () => {
    await withTmpDb(async (dbPath) => {
      const payload = JSON.stringify({
        query: {
          version: 2,
          root: {
            type: 'powerup',
            powerup: { by: 'rcrt', value: 't' },
          },
        },
      });
      const res = await runCli(['--json', '--remnote-db', dbPath, 'query', '--payload', '-'], {
        stdin: payload,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(true);
      expect(env.data.items.map((item: any) => item.id)).toEqual(['R1']);
      expect(env.data.items.map((item: any) => item.id)).not.toContain('D1');
    });
  });

  it('resolves query --powerup through host authoritative metadata before remote query execution', async () => {
    const api = await startJsonApiStub((request) => {
      if (request.method === 'POST' && request.url === '/v1/internal/query/resolve-powerup') {
        return {
          payload: {
            ok: true,
            data: { id: 'T1', rcrt: 't', title: 'Todo' },
          },
        };
      }

      if (request.method === 'POST' && request.url === '/v1/read/query') {
        return {
          payload: {
            ok: true,
            data: {
              totalMatched: 1,
              items: [{ id: 'R1', title: 'Task 1', snippet: 'todo row' }],
            },
          },
        };
      }

      return undefined;
    });

    try {
      const res = await runCli(['--json', '--api-base-url', api.baseUrl, 'query', '--powerup', 'Todo'], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(true);
      expect(api.requests).toHaveLength(2);
      expect(api.requests[0]?.url).toBe('/v1/internal/query/resolve-powerup');
      expect(api.requests[0]?.body).toMatchObject({ powerup: 'Todo' });
      expect(api.requests[1]?.url).toBe('/v1/read/query');
      expect(api.requests[1]?.body).toMatchObject({
        query: {
          version: 2,
          root: {
            type: 'powerup',
            powerup: { by: 'id', value: 'T1' },
          },
        },
      });
      expect(api.requests[1]?.body?.queryObj).toBeUndefined();
      expect(JSON.stringify(api.requests[1]?.body ?? {})).not.toContain('Todo');
    } finally {
      await api.close();
    }
  });

  it('rejects fuzzy powerup names in local mode and requires exact normalization', async () => {
    await withTmpDb(async (dbPath) => {
      const res = await runCli(['--json', '--remnote-db', dbPath, 'query', '--powerup', 'Tod']);

      expect(res.exitCode).toBe(2);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(false);
      expect(env.error.code).toBe('INVALID_ARGS');
      expect(String(env.error.message)).toContain('Powerup not found');
    });
  });

  it('surfaces exact-only powerup normalization failures from the host helper route', async () => {
    const api = await startJsonApiStub((request) => {
      if (request.method === 'POST' && request.url === '/v1/internal/query/resolve-powerup') {
        return {
          status: 400,
          payload: {
            ok: false,
            error: {
              code: 'INVALID_ARGS',
              message: 'Ambiguous powerup title: Todo',
            },
          },
        };
      }

      if (request.method === 'POST' && request.url === '/v1/read/query') {
        return {
          payload: {
            ok: true,
            data: {
              totalMatched: 1,
              items: [{ id: 'R1', title: 'Task 1' }],
            },
          },
        };
      }

      return undefined;
    });

    try {
      const res = await runCli(['--json', '--api-base-url', api.baseUrl, 'query', '--powerup', 'Todo'], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(2);
      expect(res.stderr).toBe('');

      const env = JSON.parse(res.stdout.trim());
      expect(env.ok).toBe(false);
      expect(env.error.code).toBe('INVALID_ARGS');
      expect(env.error.message).toBe('Ambiguous powerup title: Todo');
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toBe('/v1/internal/query/resolve-powerup');
    } finally {
      await api.close();
    }
  });
});
