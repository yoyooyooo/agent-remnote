import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

import { runCli } from '../helpers/runCli.js';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function startWsStubWithDelayedWorker(delayMs: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const readyAt = Date.now() + delayMs;
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      if (msg?.type === 'Hello') {
        ws.send(JSON.stringify({ type: 'HelloAck', ok: true, connId: 'stub-conn' }));
        return;
      }
      if (msg?.type === 'QueryClients') {
        const active = Date.now() >= readyAt;
        ws.send(
          JSON.stringify({
            type: 'Clients',
            activeWorkerConnId: active ? 'worker-1' : undefined,
            clients: active
              ? [
                  {
                    connId: 'worker-1',
                    clientType: 'remnote-plugin',
                    isActiveWorker: true,
                    readyState: 1,
                    capabilities: { worker: true, control: true, readRpc: true, batchPull: true },
                    connectedAt: Date.now(),
                    lastSeenAt: Date.now(),
                  },
                ]
              : [],
          }),
        );
      }
    });
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `ws://127.0.0.1:${port}/ws`,
    close: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('cli contract: stack ensure --wait-worker', () => {
  it('waits until an active worker appears', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-stack-'));
    const tmpHome = path.join(tmpDir, 'home');
    const apiPort = await getFreePort();
    const ws = await startWsStubWithDelayedWorker(600);

    try {
      const res = await runCli(
        ['--json', 'stack', 'ensure', '--wait-worker', '--worker-timeout-ms', '5000'],
        {
          env: {
            HOME: tmpHome,
            DAEMON_URL: ws.url,
            PORT: String(apiPort),
            REMNOTE_STORE_DB: path.join(tmpDir, 'store.sqlite'),
            REMNOTE_TMUX_REFRESH: '0',
          },
          timeoutMs: 20_000,
        },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.active_worker_conn_id).toBe('worker-1');
    } finally {
      await runCli(['--json', 'stack', 'stop'], {
        env: { HOME: tmpHome, PORT: String(apiPort), REMNOTE_STORE_DB: path.join(tmpDir, 'store.sqlite'), REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 20_000,
      }).catch(() => undefined);
      await ws.close();
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 30_000);
});
