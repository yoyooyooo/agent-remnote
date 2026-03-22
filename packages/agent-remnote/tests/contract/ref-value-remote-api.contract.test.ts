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
      let body: any;
      try {
        body = bodyText ? JSON.parse(bodyText) : undefined;
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            error: {
              code: 'INVALID_PAYLOAD',
              message: 'Invalid JSON body',
              details: { error: String((error as any)?.message || error) },
            },
          }),
        );
        return;
      }
      requests.push({ method: req.method || '', url: req.url || '', body });

      if (req.method === 'POST' && req.url === '/v1/ref/resolve') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: { remId: body?.ref === 'page:Inbox' ? 'PAGE-1' : 'RID-X' } }));
        return;
      }

      if (req.method === 'POST' && req.url === '/v1/write/apply') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: { txn_id: 'txn-ref-write', op_ids: ['op-1'], notified: true, sent: 1 } }));
        return;
      }

      if (req.method === 'POST' && req.url === '/v1/queue/wait') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              txn_id: 'txn-ref-write',
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
              id_map: [],
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

describe('cli contract: ref value remote api mode', () => {
  it('resolves non-id refs through host api before remote writes', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'rem', 'set-text', '--subject', 'page:Inbox', '--text', 'hello', '--wait'],
        {
          timeoutMs: 15_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(api.requests.map((request) => request.url)).toEqual(['/v1/ref/resolve', '/v1/write/apply', '/v1/queue/wait']);
      expect(api.requests[0]?.body).toMatchObject({ ref: 'page:Inbox' });
      expect(api.requests[1]?.body?.ops?.[0]?.payload?.rem_id).toBe('PAGE-1');
    } finally {
      await api.close();
    }
  });
});
