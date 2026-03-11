import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

import { runCli } from '../helpers/runCli.js';

async function startWsStub(params?: {
  readonly sent?: number;
  readonly nextActions?: readonly string[];
}): Promise<{ readonly url: string; readonly close: () => Promise<void>; readonly skipped: boolean }> {
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
      return { url: '', skipped: true, close: async () => {} };
    }
    throw listenResult.error;
  }

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('error', () => {});

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type === 'Hello') {
          ws.send(JSON.stringify({ type: 'HelloAck', ok: true, connId: 'stub-conn' }));
          return;
        }
        if (msg?.type === 'TriggerStartSync') {
          ws.send(
            JSON.stringify({
              type: 'StartSyncTriggered',
              sent: params?.sent ?? 0,
              reason: 'no_active_worker',
              nextActions: params?.nextActions ?? ['Switch to the target RemNote window to trigger a selection change'],
            }),
          );
          return;
        }
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

  return { url, close, skipped: false };
}

describe('cli contract: default notify/ensure + sent=0 visibility', () => {
  it('prints warnings in JSON data envelope (stderr stays empty)', async () => {
    const ws = await startWsStub({ sent: 0, nextActions: ['Check that the plugin control channel is connected'] });
    if (ws.skipped) return;
    try {
      const tmp = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-test-'));
      const storeDb = path.join(tmp, 'store.sqlite');
      const payload = JSON.stringify({ version: 1, kind: 'ops', ops: [{ type: 'delete_rem', payload: { remId: 'dummy' } }] });

      const res = await runCli(['--json', 'apply', '--payload', payload], {
        env: { DAEMON_URL: ws.url, REMNOTE_STORE_DB: storeDb },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.notified).toBe(true);
      expect(parsed.data.sent).toBe(0);
      expect(Array.isArray(parsed.data.warnings)).toBe(true);
      expect(String(parsed.data.warnings.join(' '))).toContain('sent=0');
    } finally {
      await ws.close();
    }
  });

  it('keeps stdout clean and prints sent=0 warnings to stderr in md mode', async () => {
    const ws = await startWsStub({ sent: 0, nextActions: ['Reconnect the RemNote plugin control channel'] });
    if (ws.skipped) return;
    try {
      const tmp = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-test-'));
      const storeDb = path.join(tmp, 'store.sqlite');
      const payload = JSON.stringify({ version: 1, kind: 'ops', ops: [{ type: 'delete_rem', payload: { remId: 'dummy' } }] });

      const res = await runCli(['apply', '--payload', payload], {
        env: { DAEMON_URL: ws.url, REMNOTE_STORE_DB: storeDb },
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('txn_id');
      expect(res.stderr).toContain('Warnings:');
      expect(res.stderr).toContain('sent=0');
    } finally {
      await ws.close();
    }
  });
});
