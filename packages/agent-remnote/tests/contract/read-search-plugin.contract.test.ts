import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

import { runCli } from '../helpers/runCli.js';

async function startSearchWsStub(): Promise<{
  readonly url: string;
  readonly close: () => Promise<void>;
  readonly skipped: boolean;
  readonly getLastRequest: () => any | undefined;
}> {
  const server = createServer();

  const listenResult = await new Promise<{ ok: true } | { ok: false; error: unknown }>((resolve) => {
    const onError = (error: unknown) => resolve({ ok: false, error });
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve({ ok: true });
    });
  });

  if (!listenResult.ok) {
    const anyError = listenResult.error as any;
    if (anyError?.code === 'EPERM') {
      try {
        server.close();
      } catch {}
      return { url: '', skipped: true, close: async () => {}, getLastRequest: () => undefined };
    }
    throw listenResult.error;
  }

  let lastRequest: any | undefined;
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('error', () => {});

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type !== 'SearchRequest') return;
        lastRequest = msg;
        ws.send(
          JSON.stringify({
            type: 'SearchResponse',
            requestId: msg.requestId,
            ok: true,
            budget: {
              timeoutMs: msg.timeoutMs,
              limitRequested: msg.limit,
              limitEffective: msg.limit,
              limitClamped: false,
              maxPreviewChars: 200,
              durationMs: 1,
            },
            results: [{ remId: 'test-rem', title: 'Test', snippet: 'hello world', truncated: false }],
          }),
        );
      } catch {
        // ignore
      }
    });
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const url = `ws://localhost:${port}/ws`;

  const close = async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { url, close, skipped: false, getLastRequest: () => lastRequest };
}

describe('cli contract: read search-plugin --json', () => {
  it('prints a single json envelope and keeps stderr empty', async () => {
    const ws = await startSearchWsStub();
    if (ws.skipped) return;
    try {
      const res = await runCli(['--json', 'plugin', 'search', '--no-ensure-daemon', '--query', 'hello'], {
        env: { DAEMON_URL: ws.url },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.ok).toBe(true);
      expect(Array.isArray(parsed.data.results)).toBe(true);
      expect(parsed.data.results.length).toBe(1);
    } finally {
      await ws.close();
    }
  });

  it('clamps limit and timeoutMs before sending SearchRequest', async () => {
    const ws = await startSearchWsStub();
    if (ws.skipped) return;
    try {
      const res = await runCli(
        [
          '--json',
          'plugin',
          'search',
          '--no-ensure-daemon',
          '--query',
          'hello',
          '--limit',
          '999',
          '--timeout-ms',
          '999999',
        ],
        { env: { DAEMON_URL: ws.url }, timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      const req = ws.getLastRequest();
      expect(req?.type).toBe('SearchRequest');
      expect(req?.limit).toBe(100);
      expect(req?.timeoutMs).toBe(5000);
    } finally {
      await ws.close();
    }
  });
});
