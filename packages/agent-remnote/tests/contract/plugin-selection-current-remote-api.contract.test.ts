import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';

import { runCli } from '../helpers/runCli.js';

async function startApiStub() {
  const requests: Array<{ method: string; url: string }> = [];
  const server = createServer((req, res) => {
    const url = req.url || '';
    requests.push({ method: req.method || '', url });

    if (req.method === 'GET' && url.startsWith('/v1/plugin/selection/current')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            selection_kind: 'rem',
            total_count: 1,
            truncated: false,
            ids: ['sel-1'],
            current: { id: 'sel-1', title: 'Current Selected Rem' },
            page: { id: 'page-1', title: 'Daily Notes' },
            focus: { id: 'focus-1', title: 'Focused Rem' },
            anchor: { source: 'selection', id: 'sel-1', title: 'Current Selected Rem' },
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

describe('cli contract: plugin selection current remote api mode', () => {
  it('routes current through host api and returns compact current selection summary', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(['--json', '--api-base-url', api.baseUrl, 'plugin', 'selection', 'current'], {
        timeoutMs: 15_000,
      });
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.current.id).toBe('sel-1');
      expect(parsed.data.current.title).toBe('Current Selected Rem');
      expect(parsed.data.page.title).toBe('Daily Notes');
      expect(api.requests[0]?.url).toContain('/v1/plugin/selection/current');
    } finally {
      await api.close();
    }
  });
});
