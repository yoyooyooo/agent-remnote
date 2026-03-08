import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: daemon status self-heals stale pidfile and cleans display artifacts', () => {
  it('removes stale pidfile/state and clears statusline artifacts', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-cli-test-'));
    const pidFile = path.join(tmpDir, 'ws.pid');
    const stateFile = path.join(tmpDir, 'ws.state.json');

    const artifactsDir = path.join(tmpDir, 'artifacts');
    const wsBridgeStateFile = path.join(artifactsDir, 'ws.bridge.state.json');
    const statusLineFile = path.join(artifactsDir, 'status-line.txt');
    const statusLineJsonFile = path.join(artifactsDir, 'status-line.json');

    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', path: '/ws' });
    await new Promise<void>((resolve, reject) => {
      const onError = (e: any) => {
        try {
          wss.close();
        } catch {}
        reject(e);
      };
      wss.once('error', onError);
      wss.once('listening', () => {
        wss.off('error', onError);
        resolve();
      });
    });
    const address = wss.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    if (!port) throw new Error('failed to bind websocket test server');

    wss.on('connection', (socket) => {
      socket.on('message', (raw) => {
        let msg: any;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg?.type === 'Hello') {
          socket.send(JSON.stringify({ type: 'HelloAck', ok: true }));
        } else if (msg?.type === 'QueryClients') {
          socket.send(JSON.stringify({ type: 'Clients', clients: [], activeWorkerConnId: null }));
        }
      });
    });

    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    if (!dummy.pid) throw new Error('failed to spawn dummy process');

    try {
      // Ensure pid becomes stale (not running).
      dummy.kill('SIGKILL');
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 2000);
        dummy.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });

      await fs.mkdir(artifactsDir, { recursive: true });
      await fs.writeFile(
        wsBridgeStateFile,
        JSON.stringify({ updatedAt: Date.now(), clients: [], activeWorkerConnId: null }, null, 2),
        'utf8',
      );
      await fs.writeFile(statusLineFile, 'RN\n', 'utf8');
      await fs.writeFile(statusLineJsonFile, JSON.stringify({ text: 'RN' }, null, 2), 'utf8');

      await fs.writeFile(
        pidFile,
        JSON.stringify({
          mode: 'supervisor',
          pid: dummy.pid,
          child_pid: null,
          started_at: Date.now(),
          ws_url: 'ws://localhost:0/ws',
          log_file: path.join(tmpDir, 'ws.log'),
          state_file: stateFile,
          ws_bridge_state_file: wsBridgeStateFile,
          status_line_file: statusLineFile,
          status_line_json_file: statusLineJsonFile,
          cmd: ['node', '-e', '...'],
        }),
        'utf8',
      );
      await fs.writeFile(
        stateFile,
        JSON.stringify({
          status: 'running',
          restart_count: 0,
          restart_window_started_at: Date.now(),
          backoff_until: null,
          last_exit: null,
          failed_reason: null,
        }),
        'utf8',
      );

      const res = await runCli(
        ['--json', '--daemon-url', `ws://127.0.0.1:${port}/ws`, 'daemon', 'status', '--pid-file', pidFile],
        {
          env: { HOME: tmpDir, REMNOTE_TMUX_REFRESH: '0' },
          timeoutMs: 15_000,
        },
      );
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(wsBridgeStateFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(statusLineJsonFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(statusLineFile, 'utf8')).resolves.toBe('');
    } finally {
      try {
        dummy.kill('SIGKILL');
      } catch {}
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 20_000);
});
