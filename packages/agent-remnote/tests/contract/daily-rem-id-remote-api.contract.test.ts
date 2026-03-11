import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';

import { runCli } from '../helpers/runCli.js';

async function startApiStub() {
  const requests: Array<{ method: string; url: string }> = [];
  const server = createServer((req, res) => {
    const url = req.url || '';
    requests.push({ method: req.method || '', url });

    if (req.method === 'GET' && url.startsWith('/v1/daily/rem-id')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            ref: 'daily:today',
            remId: 'D1',
            dateString: '2026/03/11',
          },
        }),
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }));
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

describe('cli contract: daily rem-id remote api mode', () => {
  it('uses host api instead of local db when apiBaseUrl is configured', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(['--ids', '--api-base-url', api.baseUrl, 'daily', 'rem-id'], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      expect(res.stdout.trim()).toBe('D1');
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toContain('/v1/daily/rem-id');
    } finally {
      await api.close();
    }
  });
});
