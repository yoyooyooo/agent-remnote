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

      if (req.method === 'POST' && req.url === '/v1/queue/wait') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              txn_id: body?.txnId,
              status: 'succeeded',
              score: 1,
              ops_total: 1,
              ops_succeeded: 1,
              ops_failed: 0,
              ops_dead: 0,
              ops_in_flight: 0,
              is_done: true,
              is_success: true,
              elapsed_ms: 12,
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

describe('cli contract: queue wait remote api mode', () => {
  it('uses REMNOTE_API_BASE_URL to call host api', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        ['--json', 'queue', 'wait', '--txn', 'txn-123', '--timeout-ms', '99', '--poll-ms', '11'],
        {
          env: { REMNOTE_API_BASE_URL: api.baseUrl },
          timeoutMs: 15_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.txn_id).toBe('txn-123');
      expect(parsed.data.status).toBe('succeeded');

      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.method).toBe('POST');
      expect(api.requests[0]?.url).toBe('/v1/queue/wait');
      expect(api.requests[0]?.body).toMatchObject({ txnId: 'txn-123', timeoutMs: 99, pollMs: 11 });
    } finally {
      await api.close();
    }
  });
});
