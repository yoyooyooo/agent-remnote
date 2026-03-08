import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';

import { runCli } from '../helpers/runCli.js';

async function startApiStub() {
  const requests: Array<{ method: string; url: string }> = [];
  const server = createServer((req, res) => {
    const url = req.url || '';
    requests.push({ method: req.method || '', url });

    if (req.method === 'GET' && url.startsWith('/v1/plugin/current')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            page: { id: 'page-1', title: 'Daily Notes' },
            focus: { id: 'focus-1', title: 'Focus Rem' },
            current: { source: 'selection', id: 'sel-1', title: 'Selected Rem' },
            selection: {
              kind: 'rem',
              total_count: 2,
              truncated: false,
              ids: ['sel-1', 'sel-2'],
              shown: [
                { id: 'sel-1', title: 'Selected Rem' },
                { id: 'sel-2', title: 'Sibling Rem' },
              ],
            },
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

describe('cli contract: plugin current compact remote api mode', () => {
  it('returns a compact current-context summary for agents', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(['--json', '--api-base-url', api.baseUrl, 'plugin', 'current', '--compact'], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data).toEqual({
        current_source: 'selection',
        current_id: 'sel-1',
        current_title: 'Selected Rem',
        page_id: 'page-1',
        page_title: 'Daily Notes',
        focus_id: 'focus-1',
        focus_title: 'Focus Rem',
        selection_kind: 'rem',
        selection_count: 2,
        selection_truncated: false,
        selection_ids: ['sel-1', 'sel-2'],
      });
      expect(api.requests[0]?.url).toContain('/v1/plugin/current');
    } finally {
      await api.close();
    }
  });
});
