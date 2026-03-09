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

  it('supports global api host/port/base path overrides', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-config-global-api-'));

    try {
      const res = await runCli(
        ['--json', '--api-host', '127.0.0.1', '--api-port', '3010', '--api-base-path', 'v2', 'config', 'print'],
        { env: { HOME: tmpDir } },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      expect(parseJsonLine(res.stdout).data).toMatchObject({
        api_host: '127.0.0.1',
        api_port: 3010,
        api_base_path: '/v2',
      });
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

  it('supports set, get, list, and unset roundtrip for apiPort', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-config-port-'));
    const tmpHome = path.join(tmpDir, 'home');

    try {
      const setRes = await runCli(['--json', 'config', 'set', '--key', 'apiPort', '--value', '3001'], {
        env: { HOME: tmpHome },
      });
      expect(setRes.exitCode).toBe(0);
      expect(setRes.stderr).toBe('');
      expect(parseJsonLine(setRes.stdout).data).toMatchObject({
        key: 'apiPort',
        value: 3001,
      });

      const getRes = await runCli(['--json', 'config', 'get', '--key', 'apiPort'], { env: { HOME: tmpHome } });
      expect(getRes.exitCode).toBe(0);
      expect(getRes.stderr).toBe('');
      expect(parseJsonLine(getRes.stdout).data).toMatchObject({
        key: 'apiPort',
        value: 3001,
        exists: true,
      });

      const listRes = await runCli(['--json', 'config', 'list'], { env: { HOME: tmpHome } });
      expect(listRes.exitCode).toBe(0);
      expect(listRes.stderr).toBe('');
      expect(parseJsonLine(listRes.stdout).data.values).toMatchObject({
        apiPort: 3001,
      });

      const printRes = await runCli(['--json', 'config', 'print'], { env: { HOME: tmpHome } });
      expect(printRes.exitCode).toBe(0);
      expect(printRes.stderr).toBe('');
      expect(parseJsonLine(printRes.stdout).data).toMatchObject({
        api_port: 3001,
      });

      const unsetRes = await runCli(['--json', 'config', 'unset', '--key', 'apiPort'], { env: { HOME: tmpHome } });
      expect(unsetRes.exitCode).toBe(0);
      expect(unsetRes.stderr).toBe('');
      expect(parseJsonLine(unsetRes.stdout).data).toMatchObject({
        key: 'apiPort',
        removed: true,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000);

  it('supports set, get, list, and unset roundtrip for apiHost and apiBasePath', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-config-host-path-'));
    const tmpHome = path.join(tmpDir, 'home');

    try {
      const setHostRes = await runCli(['--json', 'config', 'set', '--key', 'apiHost', '--value', '127.0.0.1'], {
        env: { HOME: tmpHome },
      });
      expect(setHostRes.exitCode).toBe(0);
      expect(setHostRes.stderr).toBe('');
      expect(parseJsonLine(setHostRes.stdout).data).toMatchObject({ key: 'apiHost', value: '127.0.0.1' });

      const setPathRes = await runCli(['--json', 'config', 'set', '--key', 'apiBasePath', '--value', 'v2'], {
        env: { HOME: tmpHome },
      });
      expect(setPathRes.exitCode).toBe(0);
      expect(setPathRes.stderr).toBe('');
      expect(parseJsonLine(setPathRes.stdout).data).toMatchObject({ key: 'apiBasePath', value: '/v2' });

      const listRes = await runCli(['--json', 'config', 'list'], { env: { HOME: tmpHome } });
      expect(listRes.exitCode).toBe(0);
      expect(listRes.stderr).toBe('');
      expect(parseJsonLine(listRes.stdout).data.values).toMatchObject({
        apiHost: '127.0.0.1',
        apiBasePath: '/v2',
      });

      const printRes = await runCli(['--json', 'config', 'print'], { env: { HOME: tmpHome } });
      expect(printRes.exitCode).toBe(0);
      expect(printRes.stderr).toBe('');
      expect(parseJsonLine(printRes.stdout).data).toMatchObject({
        api_host: '127.0.0.1',
        api_base_path: '/v2',
      });

      const unsetHostRes = await runCli(['--json', 'config', 'unset', '--key', 'apiHost'], { env: { HOME: tmpHome } });
      expect(unsetHostRes.exitCode).toBe(0);
      expect(unsetHostRes.stderr).toBe('');
      expect(parseJsonLine(unsetHostRes.stdout).data).toMatchObject({ key: 'apiHost', removed: true });

      const unsetPathRes = await runCli(['--json', 'config', 'unset', '--key', 'apiBasePath'], {
        env: { HOME: tmpHome },
      });
      expect(unsetPathRes.exitCode).toBe(0);
      expect(unsetPathRes.stderr).toBe('');
      expect(parseJsonLine(unsetPathRes.stdout).data).toMatchObject({ key: 'apiBasePath', removed: true });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000);

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

  it('validates invalid apiPort values in user config file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-config-invalid-port-'));
    const tmpHome = path.join(tmpDir, 'home');
    const configDir = path.join(tmpHome, '.agent-remnote');
    const configFile = path.join(configDir, 'config.json');

    try {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configFile, '{\n  "apiPort": 70000\n}\n', 'utf8');

      const res = await runCli(['--json', 'config', 'validate'], { env: { HOME: tmpHome } });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      expect(parseJsonLine(res.stdout).data).toMatchObject({
        valid: false,
        config_file: path.normalize(configFile),
      });
      expect(parseJsonLine(res.stdout).data.errors[0]).toContain('apiPort');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('validates invalid apiHost type in user config file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-config-invalid-host-'));
    const tmpHome = path.join(tmpDir, 'home');
    const configDir = path.join(tmpHome, '.agent-remnote');
    const configFile = path.join(configDir, 'config.json');

    try {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configFile, '{\n  "apiHost": 123\n}\n', 'utf8');

      const res = await runCli(['--json', 'config', 'validate'], { env: { HOME: tmpHome } });
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      expect(parseJsonLine(res.stdout).data).toMatchObject({ valid: false, config_file: path.normalize(configFile) });
      expect(parseJsonLine(res.stdout).data.errors[0]).toContain('apiHost');
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
