import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

      if (req.method === 'POST' && req.url === '/v1/search/db') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              query: body?.query,
              limit: body?.limit,
              markdown: '- remote search ok\n',
              results: [{ remId: 'r1', title: 'Remote Result' }],
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

function writeTempConfigFile(payload: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-remnote-config-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  return file;
}

describe('cli contract: search remote api mode via user config file', () => {
  it('uses REMNOTE_CONFIG_FILE apiBaseUrl without extra CLI flags', async () => {
    const api = await startApiStub();
    const configFile = writeTempConfigFile({ apiBaseUrl: api.baseUrl });
    try {
      const res = await runCli(['--json', 'search', '--query', 'hello', '--limit', '7'], {
        env: { REMNOTE_CONFIG_FILE: configFile },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.query).toBe('hello');
      expect(parsed.data.limit).toBe(7);
      expect(parsed.data.results[0].title).toBe('Remote Result');

      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.method).toBe('POST');
      expect(api.requests[0]?.url).toBe('/v1/search/db');
      expect(api.requests[0]?.body).toMatchObject({ query: 'hello', limit: 7 });
    } finally {
      await api.close();
    }
  });
});
