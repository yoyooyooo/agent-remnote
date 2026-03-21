import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: rem children replace --selection', () => {
  it('resolves the current selected rem locally and compiles backup/assert fields (dry-run)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-selection-'));
    const statePath = path.join(tmpDir, 'ws.bridge.state.json');
    const now = Date.now();

    try {
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            updatedAt: now,
            clients: [
              {
                connId: 'test-conn',
                isActiveWorker: true,
                connectedAt: now - 1000,
                lastSeenAt: now - 500,
                readyState: 1,
                selection: {
                  selectionType: 'Rem',
                  totalCount: 1,
                  truncated: false,
                  remIds: ['SEL-1'],
                  updatedAt: now - 500,
                },
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );

      const res = await runCli([
        '--json',
        'rem',
        'children',
        'replace',
        '--selection',
        '--state-file',
        statePath,
        '--markdown',
        '- Report\n  - detail',
        '--backup',
        'visible',
        '--assert',
        'single-root',
        '--assert',
        'preserve-anchor',
        '--dry-run',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.dry_run).toBe(true);
      expect(parsed.data.target).toEqual({
        source: 'selection',
        rem_id: 'SEL-1',
      });
      expect(parsed.data.ops[0].type).toBe('replace_children_with_markdown');
      expect(parsed.data.ops[0].payload.parent_id).toBe('SEL-1');
      expect(parsed.data.ops[0].payload.backup).toBe('visible');
      expect(parsed.data.ops[0].payload.assertions).toEqual(['single-root', 'preserve-anchor']);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves the current selected rem through host api in remote mode (dry-run)', async () => {
    const requests: Array<{ method?: string; url?: string }> = [];
    const server = createServer((req, res) => {
      requests.push({ method: req.method, url: req.url });
      if (req.method === 'GET' && req.url === '/v1/plugin/selection/current') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              selection_kind: 'rem',
              total_count: 1,
              truncated: false,
              ids: ['REMOTE-SEL-1'],
              current: { id: 'REMOTE-SEL-1', title: 'Selected Rem' },
              page: null,
              focus: null,
            },
          }),
        );
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const res = await runCli([
        '--json',
        '--api-base-url',
        `http://127.0.0.1:${port}`,
        'rem',
        'children',
        'replace',
        '--selection',
        '--markdown',
        '- Report\n  - detail',
        '--dry-run',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.target).toEqual({
        source: 'selection',
        rem_id: 'REMOTE-SEL-1',
      });
      expect(parsed.data.ops[0].payload.parent_id).toBe('REMOTE-SEL-1');
      expect(requests.some((request) => request.url === '/v1/plugin/selection/current')).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('includes a normalized backup summary after --wait succeeds', async () => {
    const requests: Array<{ method?: string; url?: string }> = [];
    const server = createServer((req, res) => {
      requests.push({ method: req.method, url: req.url });
      if (req.method === 'POST' && req.url === '/v1/write/apply') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              txn_id: 'txn-backup-1',
              op_ids: ['op-backup-1'],
              notified: true,
              sent: 1,
            },
          }),
        );
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/queue/wait') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              txn_id: 'txn-backup-1',
              status: 'succeeded',
              ops_total: 1,
              ops_succeeded: 1,
              ops_failed: 0,
              ops_dead: 0,
              ops_in_flight: 0,
              score: 100,
              is_done: true,
              is_success: true,
              elapsed_ms: 1,
            },
          }),
        );
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/queue/txns/txn-backup-1') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              txn: { txn_id: 'txn-backup-1', status: 'succeeded' },
              ops: [
                {
                  op_id: 'op-backup-1',
                  type: 'replace_children_with_markdown',
                  status: 'succeeded',
                  result: {
                    result_json: JSON.stringify({
                      backup_policy: 'visible',
                      backup_deleted: false,
                      backup_rem_id: 'backup-rem-1',
                    }),
                  },
                },
              ],
              id_map: [],
            },
          }),
        );
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const res = await runCli([
        '--json',
        '--api-base-url',
        `http://127.0.0.1:${port}`,
        'rem',
        'children',
        'replace',
        '--subject',
        'PARENT-1',
        '--markdown',
        '- Report\n  - detail',
        '--backup',
        'visible',
        '--wait',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.backup).toEqual({
        policy: 'visible',
        deleted: false,
        rem_id: 'backup-rem-1',
      });
      expect(requests.some((request) => request.url === '/v1/queue/txns/txn-backup-1')).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
