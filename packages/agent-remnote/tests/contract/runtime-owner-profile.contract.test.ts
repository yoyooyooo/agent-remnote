import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { installPackedCli, packAgentRemnoteCli, runInstalledCli } from '../helpers/packedCli.js';
import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

function repoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../../../../');
}

function worktreeKeyFor(root: string): string {
  return createHash('sha256').update(path.normalize(root)).digest('hex').slice(0, 12);
}

function isolatedPortsFor(root: string): { readonly wsPort: number; readonly apiPort: number } {
  const seed = parseInt(createHash('sha256').update(path.normalize(root)).digest('hex').slice(0, 8), 16);
  return {
    wsPort: 46_000 + (seed % 2_000),
    apiPort: 48_000 + (seed % 2_000),
  };
}

describe('cli contract: runtime owner profile foundation', () => {
  it('resolves source-tree invocation into isolated dev defaults', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-source-'));
    const tmpHome = path.join(tmpDir, 'home');
    const controlPlaneRoot = path.join(tmpHome, '.agent-remnote');
    const worktreeRoot = repoRoot();
    const runtimeRoot = path.join(controlPlaneRoot, 'dev', worktreeKeyFor(worktreeRoot));
    const ports = isolatedPortsFor(runtimeRoot);

    try {
      const res = await runCli(['--json', 'config', 'print'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data).toMatchObject({
        runtime_profile: 'dev',
        runtime_port_class: 'isolated',
        install_source: 'source_tree',
        control_plane_root: path.normalize(controlPlaneRoot),
        runtime_root: path.normalize(runtimeRoot),
        worktree_root: path.normalize(worktreeRoot),
        config_file: path.normalize(path.join(controlPlaneRoot, 'config.json')),
        store_db: path.normalize(path.join(runtimeRoot, 'store.sqlite')),
        ws_url: `ws://localhost:${ports.wsPort}/ws`,
        api_port: ports.apiPort,
        ws_bridge_state_file: path.normalize(path.join(runtimeRoot, 'ws.bridge.state.json')),
        status_line_file: path.normalize(path.join(runtimeRoot, 'status-line.txt')),
        status_line_json_file: path.normalize(path.join(runtimeRoot, 'status-line.json')),
        daemon_pid_file_default: path.normalize(path.join(runtimeRoot, 'ws.pid')),
        daemon_log_file_default: path.normalize(path.join(runtimeRoot, 'ws.log')),
        supervisor_state_file_default: path.normalize(path.join(runtimeRoot, 'ws.state.json')),
        api_pid_file: path.normalize(path.join(runtimeRoot, 'api.pid')),
        api_log_file: path.normalize(path.join(runtimeRoot, 'api.log')),
        api_state_file: path.normalize(path.join(runtimeRoot, 'api.state.json')),
      });
      expect(parsed.data.runtime_root).not.toBe(path.normalize(controlPlaneRoot));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves packed install invocation into stable defaults', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-packed-'));
    const tmpHome = path.join(tmpDir, 'home');
    const controlPlaneRoot = path.join(tmpHome, '.agent-remnote');

    const packed = await packAgentRemnoteCli();
    try {
      const installed = await installPackedCli(packed.tarballPath);
      try {
        const res = await runInstalledCli({
          cliPath: installed.cliPath,
          args: ['--json', 'config', 'print'],
          env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
          timeoutMs: 60_000,
        });

        expect(res.exitCode).toBe(0);
        expect(res.stderr).toBe('');

        const parsed = parseJsonLine(res.stdout);
        expect(parsed.ok).toBe(true);
        expect(parsed.data).toMatchObject({
          runtime_profile: 'stable',
          runtime_port_class: 'canonical',
          install_source: 'published_install',
          control_plane_root: path.normalize(controlPlaneRoot),
          runtime_root: path.normalize(controlPlaneRoot),
          config_file: path.normalize(path.join(controlPlaneRoot, 'config.json')),
          store_db: path.normalize(path.join(controlPlaneRoot, 'store.sqlite')),
          ws_url: 'ws://localhost:6789/ws',
          api_port: 3000,
          ws_bridge_state_file: path.normalize(path.join(controlPlaneRoot, 'ws.bridge.state.json')),
          daemon_pid_file_default: path.normalize(path.join(controlPlaneRoot, 'ws.pid')),
          api_pid_file: path.normalize(path.join(controlPlaneRoot, 'api.pid')),
          api_log_file: path.normalize(path.join(controlPlaneRoot, 'api.log')),
          api_state_file: path.normalize(path.join(controlPlaneRoot, 'api.state.json')),
        });
      } finally {
        await fs.rm(installed.installDir, { recursive: true, force: true });
      }
    } finally {
      await fs.rm(packed.workDir, { recursive: true, force: true });
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 180_000);
});
