import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { WebSocketServer } from 'ws';

import { enqueueTxn, openQueueDb } from '../../src/internal/queue/index.js';
import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

function startMockWsServer(handler: (msg: any) => any) {
  const wss = new WebSocketServer({ port: 0, path: '/ws' });
  wss.on('connection', (socket) => {
    socket.on('message', (data) => {
      let msg: any = null;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      const reply = handler(msg);
      if (reply !== undefined) {
        socket.send(JSON.stringify(reply));
      }
    });
  });
  const port = (wss.address() as any).port as number;
  return { wss, url: `ws://localhost:${port}/ws` };
}

describe('cli contract: daemon sync conflict warnings --json', () => {
  it('includes warnings/nextActions when high-risk conflict clusters exist', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-daemon-sync-conflicts-'));
    const dbPath = path.join(tmpDir, 'store.sqlite');

    const { wss, url } = startMockWsServer((msg) => {
      if (msg?.type !== 'TriggerStartSync') return undefined;
      return { type: 'StartSyncTriggered', sent: 1, activeConnId: 'conn_test' };
    });

    try {
      const db = openQueueDb(dbPath);
      try {
        enqueueTxn(db as any, [{ type: 'update_text', payload: { remId: 'A', text: '1' } }]);
        enqueueTxn(db as any, [{ type: 'delete_rem', payload: { remId: 'A' } }]);
      } finally {
        db.close();
      }

      const res = await runCli(['--json', '--store-db', dbPath, '--daemon-url', url, 'daemon', 'sync', '--no-ensure-daemon']);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);

      const data = env.data as any;
      expect(data.sent).toBe(1);
      expect(data.activeConnId).toBe('conn_test');
      expect(Array.isArray(data.warnings)).toBe(true);
      expect(String(data.warnings[0] ?? '')).toContain('High-risk conflict clusters detected');
      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions).toContain('agent-remnote queue conflicts');
    } finally {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 15_000);
});
