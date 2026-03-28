import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

async function waitForJsonFile(filePath: string, timeoutMs = 3000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

describe('cli contract: runtime owner takeover', () => {
  it('transfers the canonical claim from stable to dev when no live services block the change', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-takeover-dev-'));
    const tmpHome = path.join(tmpDir, 'home');
    const claimFile = path.join(tmpHome, '.agent-remnote', 'fixed-owner-claim.json');

    try {
      const res = await runCli(['--json', 'stack', 'takeover', '--channel', 'dev'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.previous_claim).toMatchObject({ claimed_channel: 'stable' });
      expect(parsed.data.next_claim).toMatchObject({ claimed_channel: 'dev', port_class: 'canonical' });
      expect(parsed.data.stopped_services).toEqual([]);
      const touched = new Set<string>([...parsed.data.restarted_services, ...parsed.data.skipped_services]);
      expect(touched.has('daemon')).toBe(true);
      expect(touched.has('api')).toBe(true);
      expect(touched.has('plugin')).toBe(true);

      const onDisk = JSON.parse(await fs.readFile(claimFile, 'utf8'));
      expect(onDisk).toMatchObject({ claimed_channel: 'dev', updated_by: 'stack_takeover' });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('starts the local dev bundle after takeover to dev', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-takeover-dev-start-'));
    const tmpHome = path.join(tmpDir, 'home');
    const env = {
      HOME: tmpHome,
      REMNOTE_TMUX_REFRESH: '0',
      REMNOTE_STORE_DB: path.join(tmpDir, 'store.sqlite'),
    };

    try {
      const res = await runCli(['--json', 'stack', 'takeover', '--channel', 'dev'], {
        env,
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      const touched = new Set<string>([...parsed.data.restarted_services, ...parsed.data.skipped_services]);
      expect(touched.has('daemon')).toBe(true);
      expect(touched.has('api')).toBe(true);
      expect(touched.has('plugin')).toBe(true);
    } finally {
      await runCli(['--json', 'stack', 'stop'], { env, timeoutMs: 30_000 }).catch(() => undefined);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('transfers the canonical claim back to stable', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-takeover-stable-'));
    const tmpHome = path.join(tmpDir, 'home');
    const controlPlaneRoot = path.join(tmpHome, '.agent-remnote');
    const claimFile = path.join(controlPlaneRoot, 'fixed-owner-claim.json');

    try {
      await fs.mkdir(controlPlaneRoot, { recursive: true });
      await fs.writeFile(
        claimFile,
        JSON.stringify(
          {
            claimed_channel: 'dev',
            claimed_owner_id: 'dev',
            runtime_root: path.join(controlPlaneRoot, 'dev', 'fixture'),
            control_plane_root: controlPlaneRoot,
            port_class: 'canonical',
            updated_by: 'stack_takeover',
            updated_at: 1,
            worktree_root: '/tmp/example-worktree',
            launcher_ref: 'source:/tmp/example-worktree',
          },
          null,
          2,
        ),
        'utf8',
      );

      const res = await runCli(['--json', 'stack', 'takeover', '--channel', 'stable'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.previous_claim).toMatchObject({ claimed_channel: 'dev' });
      expect(parsed.data.next_claim).toMatchObject({
        claimed_channel: 'stable',
        runtime_root: controlPlaneRoot,
        port_class: 'canonical',
      });

      const onDisk = JSON.parse(await fs.readFile(claimFile, 'utf8'));
      expect(onDisk).toMatchObject({ claimed_channel: 'stable', updated_by: 'stack_takeover' });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reclaims to stable by stopping the current dev bundle', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-takeover-stable-stop-'));
    const tmpHome = path.join(tmpDir, 'home');
    const env = {
      HOME: tmpHome,
      REMNOTE_TMUX_REFRESH: '0',
      REMNOTE_STORE_DB: path.join(tmpDir, 'store.sqlite'),
    };

    try {
      const devRes = await runCli(['--json', 'stack', 'takeover', '--channel', 'dev'], {
        env,
        timeoutMs: 30_000,
      });
      expect(devRes.exitCode).toBe(0);

      const stableRes = await runCli(['--json', 'stack', 'takeover', '--channel', 'stable'], {
        env,
        timeoutMs: 30_000,
      });
      expect(stableRes.exitCode).toBe(0);
      expect(stableRes.stderr).toBe('');
      const parsed = parseJsonLine(stableRes.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.stopped_services).toEqual(expect.arrayContaining(['daemon', 'api', 'plugin']));

      const statusRes = await runCli(['--json', 'stack', 'status'], {
        env,
        timeoutMs: 30_000,
      });
      expect(statusRes.exitCode).toBe(0);
      const status = parseJsonLine(statusRes.stdout);
      expect(status.data.services.daemon.running).toBe(false);
      expect(status.data.services.api.running).toBe(false);
      expect(status.data.services.plugin.running).toBe(false);
    } finally {
      await runCli(['--json', 'stack', 'stop'], { env, timeoutMs: 30_000 }).catch(() => undefined);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('invokes the stable launcher during reclaim', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-stable-launcher-'));
    const tmpHome = path.join(tmpDir, 'home');
    const markerFile = path.join(tmpDir, 'stable-launcher.json');
    const launcherScript = path.join(tmpDir, 'stable-launcher.js');
    const env = {
      HOME: tmpHome,
      REMNOTE_TMUX_REFRESH: '0',
      REMNOTE_STORE_DB: path.join(tmpDir, 'store.sqlite'),
      AGENT_REMNOTE_STABLE_LAUNCHER_CMD: process.execPath,
      AGENT_REMNOTE_STABLE_LAUNCHER_ARGS_JSON: JSON.stringify([launcherScript, markerFile]),
    };

    try {
      await fs.writeFile(
        launcherScript,
        [
          "const fs = require('node:fs');",
          "const marker = process.argv[2];",
          "const args = process.argv.slice(3);",
          "fs.writeFileSync(marker, JSON.stringify({ args }, null, 2));",
        ].join('\n'),
        'utf8',
      );

      const devRes = await runCli(['--json', 'stack', 'takeover', '--channel', 'dev'], {
        env,
        timeoutMs: 30_000,
      });
      expect(devRes.exitCode).toBe(0);

      const stableRes = await runCli(['--json', 'stack', 'takeover', '--channel', 'stable'], {
        env,
        timeoutMs: 30_000,
      });
      expect(stableRes.exitCode).toBe(0);

      const marker = await waitForJsonFile(markerFile);
      expect(marker.args).toEqual(expect.arrayContaining(['stack', 'ensure']));
    } finally {
      await runCli(['--json', 'stack', 'stop'], { env, timeoutMs: 30_000 }).catch(() => undefined);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('falls back to the Volta shim when no explicit stable launcher is configured', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-volta-launcher-'));
    const tmpHome = path.join(tmpDir, 'home');
    const markerFile = path.join(tmpDir, 'volta-launcher.json');
    const voltaHome = path.join(tmpDir, '.volta');
    const binDir = path.join(voltaHome, 'bin');
    const shim = path.join(binDir, process.platform === 'win32' ? 'agent-remnote.cmd' : 'agent-remnote');
    const env = {
      HOME: tmpHome,
      REMNOTE_TMUX_REFRESH: '0',
      REMNOTE_STORE_DB: path.join(tmpDir, 'store.sqlite'),
      VOLTA_HOME: voltaHome,
    };

    try {
      await fs.mkdir(binDir, { recursive: true });
      if (process.platform === 'win32') {
        await fs.writeFile(
          shim,
          [
            '@echo off',
            `node -e "require('fs').writeFileSync(${JSON.stringify(markerFile)}, JSON.stringify({ args: process.argv.slice(1) }, null, 2))" %*`,
          ].join('\r\n'),
          'utf8',
        );
      } else {
        await fs.writeFile(
          shim,
          [
            '#!/usr/bin/env node',
            `require('fs').writeFileSync(${JSON.stringify(markerFile)}, JSON.stringify({ args: process.argv.slice(2) }, null, 2));`,
          ].join('\n'),
          'utf8',
        );
        await fs.chmod(shim, 0o755);
      }

      const devRes = await runCli(['--json', 'stack', 'takeover', '--channel', 'dev'], {
        env,
        timeoutMs: 30_000,
      });
      expect(devRes.exitCode).toBe(0);

      const stableRes = await runCli(['--json', 'stack', 'takeover', '--channel', 'stable'], {
        env,
        timeoutMs: 30_000,
      });
      expect(stableRes.exitCode).toBe(0);

      const marker = await waitForJsonFile(markerFile);
      expect(marker.args).toEqual(expect.arrayContaining(['stack', 'ensure']));
    } finally {
      await runCli(['--json', 'stack', 'stop'], { env, timeoutMs: 30_000 }).catch(() => undefined);
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);
});
