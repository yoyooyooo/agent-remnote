import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: strict remote mode blocks local-only reads', () => {
  it('rejects db recent when apiBaseUrl is configured', async () => {
    const res = await runCli(['--json', '--api-base-url', 'http://127.0.0.1:9', 'db', 'recent'], {
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
    expect(String(parsed.error.message)).toContain('apiBaseUrl');
  });

  it('rejects table show when apiBaseUrl is configured', async () => {
    const res = await runCli(['--json', '--api-base-url', 'http://127.0.0.1:9', 'table', 'show', '--id', 'tag-1'], {
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
    expect(String(parsed.error.message)).toContain('apiBaseUrl');
  });

  it('routes daily write through host api when apiBaseUrl is configured', async () => {
    const requests: Array<{ method?: string; url?: string; body?: string }> = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, body: raw });
        if (req.url === '/v1/write/apply') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              data: {
                txn_id: 'txn-remote-daily',
                op_ids: ['op-1'],
                notified: true,
                sent: 1,
              },
            }),
          );
          return;
        }
        if (req.url === '/v1/queue/wait') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              data: {
                txn_id: 'txn-remote-daily',
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
                last_update_at: 0,
              },
            }),
          );
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const res = await runCli(
        ['--json', '--api-base-url', `http://127.0.0.1:${port}`, 'daily', 'write', '--text', 'hello remote'],
        {
          timeoutMs: 15_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data?.txn_id).toBe('txn-remote-daily');
      expect(requests.some((request) => request.url === '/v1/write/apply')).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
