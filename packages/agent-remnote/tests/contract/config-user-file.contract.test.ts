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

describe('cli contract: config user file', () => {
  it('prints the active user config path', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-config-path-'));
    const tmpHome = path.join(tmpDir, 'home');

    try {
      const res = await runCli(['--json', 'config', 'path'], { env: { HOME: tmpHome } });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.config_file).toBe(path.normalize(path.join(tmpHome, '.agent-remnote', 'config.json')));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('supports global --config-file override', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-config-flag-'));
    const configFile = path.join(tmpDir, 'custom', 'agent-remnote.json');

    try {
      const setRes = await runCli(
        [
          '--json',
          '--config-file',
          configFile,
          'config',
          'set',
          '--key',
          'apiBaseUrl',
          '--value',
          'http://127.0.0.1:3001',
        ],
        { env: { HOME: tmpDir } },
      );
      expect(setRes.exitCode).toBe(0);
      expect(setRes.stderr).toBe('');
      expect(parseJsonLine(setRes.stdout).data.config_file).toBe(path.normalize(configFile));

      const getRes = await runCli(['--json', '--config-file', configFile, 'config', 'get', '--key', 'apiBaseUrl'], {
        env: { HOME: tmpDir },
      });
      expect(getRes.exitCode).toBe(0);
      expect(getRes.stderr).toBe('');
      expect(parseJsonLine(getRes.stdout).data).toMatchObject({
        key: 'apiBaseUrl',
        value: 'http://127.0.0.1:3001',
        exists: true,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('supports set, get, list, and unset roundtrip for apiBaseUrl', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-config-roundtrip-'));
    const tmpHome = path.join(tmpDir, 'home');
    const configFile = path.join(tmpHome, '.agent-remnote', 'config.json');

    try {
      const setRes = await runCli(
        ['--json', 'config', 'set', '--key', 'apiBaseUrl', '--value', 'http://host.docker.internal:3000'],
        { env: { HOME: tmpHome } },
      );
      expect(setRes.exitCode).toBe(0);
      expect(setRes.stderr).toBe('');
      expect(parseJsonLine(setRes.stdout).data).toMatchObject({
        key: 'apiBaseUrl',
        value: 'http://host.docker.internal:3000',
        config_file: path.normalize(configFile),
      });

      const getRes = await runCli(['--json', 'config', 'get', '--key', 'apiBaseUrl'], { env: { HOME: tmpHome } });
      expect(getRes.exitCode).toBe(0);
      expect(getRes.stderr).toBe('');
      expect(parseJsonLine(getRes.stdout).data).toMatchObject({
        key: 'apiBaseUrl',
        value: 'http://host.docker.internal:3000',
        exists: true,
      });

      const listRes = await runCli(['--json', 'config', 'list'], { env: { HOME: tmpHome } });
      expect(listRes.exitCode).toBe(0);
      expect(listRes.stderr).toBe('');
      expect(parseJsonLine(listRes.stdout).data.values).toMatchObject({
        apiBaseUrl: 'http://host.docker.internal:3000',
      });

      const unsetRes = await runCli(['--json', 'config', 'unset', '--key', 'apiBaseUrl'], { env: { HOME: tmpHome } });
      expect(unsetRes.exitCode).toBe(0);
      expect(unsetRes.stderr).toBe('');
      expect(parseJsonLine(unsetRes.stdout).data).toMatchObject({
        key: 'apiBaseUrl',
        removed: true,
      });

      const getAfterUnsetRes = await runCli(['--json', 'config', 'get', '--key', 'apiBaseUrl'], {
        env: { HOME: tmpHome },
      });
      expect(getAfterUnsetRes.exitCode).toBe(0);
      expect(getAfterUnsetRes.stderr).toBe('');
      expect(parseJsonLine(getAfterUnsetRes.stdout).data).toMatchObject({
        key: 'apiBaseUrl',
        exists: false,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000);

  it('lists nested api.baseUrl as canonical apiBaseUrl', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-config-alias-'));
    const tmpHome = path.join(tmpDir, 'home');
    const configDir = path.join(tmpHome, '.agent-remnote');
    const configFile = path.join(configDir, 'config.json');

    try {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configFile, '{\n  "api": { "baseUrl": "http://127.0.0.1:3001" }\n}\n', 'utf8');

      const res = await runCli(['--json', 'config', 'list'], { env: { HOME: tmpHome } });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      expect(parseJsonLine(res.stdout).data.values).toMatchObject({
        apiBaseUrl: 'http://127.0.0.1:3001',
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('validates semantic errors in user config file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-config-validate-'));
    const tmpHome = path.join(tmpDir, 'home');
    const configDir = path.join(tmpHome, '.agent-remnote');
    const configFile = path.join(configDir, 'config.json');

    try {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configFile, '{\n  "apiBaseUrl": 123\n}\n', 'utf8');

      const res = await runCli(['--json', 'config', 'validate'], { env: { HOME: tmpHome } });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      expect(parseJsonLine(res.stdout).data).toMatchObject({
        valid: false,
        config_file: path.normalize(configFile),
      });
      expect(parseJsonLine(res.stdout).data.errors[0]).toContain('apiBaseUrl');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
