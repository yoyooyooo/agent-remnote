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

describe('cli contract: runtime owner status foundation', () => {
  it('config print exposes canonical fixed-owner claim details', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-config-'));
    const tmpHome = path.join(tmpDir, 'home');
    const controlPlaneRoot = path.join(tmpHome, '.agent-remnote');

    try {
      const res = await runCli(['--json', 'config', 'print'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.fixed_owner_claim_file).toBe(path.normalize(path.join(controlPlaneRoot, 'fixed-owner-claim.json')));
      expect(parsed.data.fixed_owner_claim).toMatchObject({
        claimed_channel: 'stable',
        runtime_root: path.normalize(controlPlaneRoot),
        control_plane_root: path.normalize(controlPlaneRoot),
        port_class: 'canonical',
        updated_by: 'initial_bootstrap',
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('stack status exposes resolved local profile and canonical fixed-owner claim separately', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-runtime-owner-stack-'));
    const tmpHome = path.join(tmpDir, 'home');
    const controlPlaneRoot = path.join(tmpHome, '.agent-remnote');

    try {
      const res = await runCli(['--json', 'stack', 'status'], {
        env: { HOME: tmpHome, REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 30_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.resolved_local).toMatchObject({
        profile: 'dev',
        install_source: 'source_tree',
      });
      expect(typeof parsed.data.resolved_local.runtime_root).toBe('string');
      expect(parsed.data.control_plane_root).toBe(path.normalize(controlPlaneRoot));
      expect(parsed.data.fixed_owner_claim).toMatchObject({
        claimed_channel: 'stable',
        runtime_root: path.normalize(controlPlaneRoot),
        port_class: 'canonical',
      });
      expect(parsed.data.services).toMatchObject({
        daemon: { owner: null, trusted: false, claimed: false },
        api: { owner: null, trusted: false, claimed: false },
        plugin: { owner: null, trusted: false, claimed: false },
      });
      expect(Array.isArray(parsed.data.ownership_conflicts)).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
