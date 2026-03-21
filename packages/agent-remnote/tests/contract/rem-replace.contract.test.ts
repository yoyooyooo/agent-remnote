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

describe('cli contract: rem replace', () => {
  it('compiles surface=children with an explicit rem target (dry-run)', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'replace',
      '--subject',
      'RID-1',
      '--surface',
      'children',
      '--markdown',
      '- Root\n  - Child',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.dry_run).toBe(true);
    expect(parsed.data.target).toEqual({
      source: 'explicit',
      rem_ids: ['RID-1'],
    });
    expect(parsed.data.ops[0].type).toBe('replace_children_with_markdown');
    expect(parsed.data.ops[0].payload.parent_id).toBe('RID-1');
    expect(parsed.data.ops[0].payload.markdown).toBe('- Root\n  - Child');
  });

  it('passes children assertions through to replace_children_with_markdown (dry-run)', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'replace',
      '--subject',
      'RID-1',
      '--surface',
      'children',
      '--assert',
      'single-root',
      '--assert',
      'no-literal-bullet',
      '--markdown',
      '- Root\n  - Child',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops[0].type).toBe('replace_children_with_markdown');
    expect(parsed.data.ops[0].payload.assertions).toEqual(['single-root', 'no-literal-bullet']);
  });

  it('resolves selection for surface=self and compiles an explicit block replace (dry-run)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-rem-replace-'));
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
                  totalCount: 2,
                  truncated: false,
                  remIds: ['RID-A', 'RID-B'],
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
        'replace',
        '--selection',
        '--state-file',
        statePath,
        '--surface',
        'self',
        '--markdown',
        '- Root\n  - Child',
        '--dry-run',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.target).toEqual({
        source: 'selection',
        rem_ids: ['RID-A', 'RID-B'],
      });
      expect(parsed.data.ops[0].type).toBe('replace_selection_with_markdown');
      expect(parsed.data.ops[0].payload.target).toEqual({
        mode: 'explicit',
        rem_ids: ['RID-A', 'RID-B'],
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects preserve-anchor when surface=self', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'replace',
      '--subject',
      'RID-A',
      '--surface',
      'self',
      '--assert',
      'preserve-anchor',
      '--markdown',
      '- Root\n  - Child',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
    expect(String(parsed.error.message)).toContain('preserve-anchor');
    expect(String(parsed.error.message)).toContain('surface=self');
  });

  it('rejects multiple targets when surface=children', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'replace',
      '--subject',
      'RID-A',
      '--subject',
      'RID-B',
      '--surface',
      'children',
      '--markdown',
      '- Root\n  - Child',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
    expect(String(parsed.error.message)).toContain('surface children');
    expect(String(parsed.error.message)).toContain('exactly one');
  });

  it('passes supported self assertions through to replace_selection_with_markdown (dry-run)', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'replace',
      '--subject',
      'RID-A',
      '--subject',
      'RID-B',
      '--surface',
      'self',
      '--assert',
      'single-root',
      '--markdown',
      '- Root',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops[0].type).toBe('replace_selection_with_markdown');
    expect(parsed.data.ops[0].payload.assertions).toEqual(['single-root']);
  });

  it('falls back to current.id when remote selection payload ids is empty', async () => {
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
              ids: [],
              current: { id: 'REMOTE-CURRENT-1', title: 'Current Rem' },
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
        'replace',
        '--selection',
        '--surface',
        'self',
        '--markdown',
        '- Root',
        '--dry-run',
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.target).toEqual({
        source: 'selection',
        rem_ids: ['REMOTE-CURRENT-1'],
      });
      expect(requests.some((request) => request.url === '/v1/plugin/selection/current')).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
