import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';

import { runCli } from '../helpers/runCli.js';

async function startApiStub() {
  const requests: Array<{ method: string; url: string; body: any }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const body = bodyText ? JSON.parse(bodyText) : undefined;
      const url = req.url || '';
      requests.push({ method: req.method || '', url, body });

      if (req.method === 'GET' && url.startsWith('/v1/plugin/selection/roots')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: { selection_type: 'Rem', total_count: 2, truncated: false, ids: ['r1', 'r2'] },
          }),
        );
        return;
      }

      if (req.method === 'POST' && url === '/v1/plugin/selection/outline') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              selection: { kind: 'rem', totalCount: 2, truncated: false, remIds: ['r1', 'r2'], updatedAt: 1 },
              params: {
                max_depth: body?.maxDepth ?? 3,
                max_nodes: body?.maxNodes ?? 100,
                detail: body?.detail === true,
              },
              exported_node_count: 4,
              truncated: false,
              roots: [
                { rootId: 'r1', title: 'Root 1', markdown: '- A', nodeCount: 2 },
                { rootId: 'r2', title: 'Root 2', markdown: '- B', nodeCount: 2 },
              ],
            },
          }),
        );
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('cli contract: plugin selection remote api mode', () => {
  it('routes roots through host api', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(['--json', '--api-base-url', api.baseUrl, 'plugin', 'selection', 'roots'], {
        timeoutMs: 15_000,
      });
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.ids).toEqual(['r1', 'r2']);
      expect(api.requests[0]?.url).toContain('/v1/plugin/selection/roots');
    } finally {
      await api.close();
    }
  });

  it('routes outline through host api', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        [
          '--json',
          '--api-base-url',
          api.baseUrl,
          'plugin',
          'selection',
          'outline',
          '--max-depth',
          '3',
          '--max-nodes',
          '100',
          '--detail',
        ],
        { timeoutMs: 15_000 },
      );
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.exported_node_count).toBe(4);
      expect(parsed.data.roots).toHaveLength(2);
      expect(api.requests[0]?.method).toBe('POST');
      expect(api.requests[0]?.url).toBe('/v1/plugin/selection/outline');
      expect(api.requests[0]?.body).toMatchObject({ maxDepth: 3, maxNodes: 100, detail: true });
    } finally {
      await api.close();
    }
  });
});
