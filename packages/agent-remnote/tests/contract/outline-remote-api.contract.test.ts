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
      requests.push({ method: req.method || '', url: req.url || '', body });

      if (req.method === 'POST' && req.url === '/v1/read/outline') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              id: 'page-1',
              nodeCount: 2,
              markdown: '# Remote Outline\n\n- child\n',
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

describe('cli contract: rem outline remote api mode', () => {
  it('uses host api instead of local db when apiBaseUrl is configured', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'rem', 'outline', '--ref', 'daily:today', '--depth', '3'],
        {
          timeoutMs: 15_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.markdown).toContain('Remote Outline');
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toBe('/v1/read/outline');
      expect(api.requests[0]?.body).toMatchObject({ ref: 'daily:today', depth: 3 });
    } finally {
      await api.close();
    }
  });
});
