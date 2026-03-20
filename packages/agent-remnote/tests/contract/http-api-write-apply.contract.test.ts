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

      if (req.method === 'POST' && req.url === '/v1/write/apply') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: { txn_id: 'txn-remote', op_ids: ['op-1'], notified: true, sent: 1, id_map: [] } }));
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
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('cli contract: http api canonical write apply route', () => {
  it('routes actions envelopes to POST /v1/write/apply in remote mode', async () => {
    const api = await startApiStub();
    try {
      const payload = JSON.stringify({
        version: 1,
        kind: 'actions',
        actions: [{ action: 'write.bullet', input: { parent_id: 'p1', text: 'hello' } }],
      });

      const res = await runCli(['--json', '--api-base-url', api.baseUrl, 'apply', '--payload', payload], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toBe('/v1/write/apply');
      expect(api.requests[0]?.body).toMatchObject({ kind: 'actions' });
    } finally {
      await api.close();
    }
  });

  it('routes ops envelopes to POST /v1/write/apply in remote mode', async () => {
    const api = await startApiStub();
    try {
      const payload = JSON.stringify({
        version: 1,
        kind: 'ops',
        ops: [{ type: 'delete_rem', payload: { rem_id: 'RID-1' } }],
      });

      const res = await runCli(['--json', '--api-base-url', api.baseUrl, 'apply', '--payload', payload], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toBe('/v1/write/apply');
      expect(api.requests[0]?.body).toMatchObject({ kind: 'ops' });
    } finally {
      await api.close();
    }
  });
});
