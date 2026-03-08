import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';

import { runCli } from '../helpers/runCli.js';

async function startApiStub() {
  const requests: Array<{ method: string; url: string; body: any }> = [];
  const server = createServer((req, res) => {
    const url = req.url || '';
    requests.push({ method: req.method || '', url, body: undefined });

    if (req.method === 'GET' && url.startsWith('/v1/plugin/ui-context/page')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          data: { page_rem_id: 'page-123', ui_context: { pageRemId: 'page-123' }, snapshot: { status: 'ok' } },
        }),
      );
      return;
    }

    if (req.method === 'GET' && url.startsWith('/v1/plugin/ui-context/describe')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            uiContext: { pageRemId: 'page-123', focusedRemId: 'focus-1' },
            selection: { kind: 'none', updatedAt: 1 },
            ui_snapshot: { status: 'ok' },
            selection_snapshot: { status: 'ok' },
            anchor: { source: 'focus', id: 'focus-1', title: 'Focus title' },
            portal: { kind: 'page', id: 'page-123', title: 'Daily Notes' },
            page: { id: 'page-123', title: 'Daily Notes' },
            focus: { id: 'focus-1', title: 'Focus title' },
            selection_items: { kind: 'none', total_count: 0, truncated: false, limit: 5, shown: [] },
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

describe('cli contract: plugin ui-context remote api mode', () => {
  it('routes page through host api', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(['--json', '--api-base-url', api.baseUrl, 'plugin', 'ui-context', 'page'], {
        timeoutMs: 15_000,
      });
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.page_rem_id).toBe('page-123');
      expect(api.requests[0]?.url).toContain('/v1/plugin/ui-context/page');
    } finally {
      await api.close();
    }
  });

  it('routes describe through host api', async () => {
    const api = await startApiStub();
    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'plugin', 'ui-context', 'describe', '--selection-limit', '5'],
        {
          timeoutMs: 15_000,
        },
      );
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.page.title).toBe('Daily Notes');
      expect(parsed.data.focus.title).toBe('Focus title');
      expect(api.requests[0]?.url).toContain('/v1/plugin/ui-context/describe');
    } finally {
      await api.close();
    }
  });
});
