import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildCliEnvConfigProvider } from '../../src/services/CliConfigProvider.js';
import { resolveConfig } from '../../src/services/Config.js';

function runWithProvider(cli: ReadonlyMap<string, string>, env: NodeJS.ProcessEnv = {}) {
  const provider = buildCliEnvConfigProvider({ cli, env });
  return Effect.runPromise(resolveConfig().pipe(Effect.withConfigProvider(provider)));
}

function writeTempConfigFile(payload: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-remnote-user-config-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  return file;
}

describe('Config user config file (unit)', () => {
  it('reads apiPort from user config file', async () => {
    const configFile = writeTempConfigFile({ apiPort: 3001 });
    const cfg = await runWithProvider(new Map(), { REMNOTE_CONFIG_FILE: configFile });
    expect(cfg.apiPort).toBe(3001);
  });

  it('prefers env apiPort over user config file', async () => {
    const configFile = writeTempConfigFile({ apiPort: 3001 });
    const cfg = await runWithProvider(new Map(), {
      REMNOTE_CONFIG_FILE: configFile,
      REMNOTE_API_PORT: '3010',
    });
    expect(cfg.apiPort).toBe(3010);
  });

  it('reads apiHost from user config file', async () => {
    const configFile = writeTempConfigFile({ apiHost: '127.0.0.1' });
    const cfg = await runWithProvider(new Map(), { REMNOTE_CONFIG_FILE: configFile });
    expect(cfg.apiHost).toBe('127.0.0.1');
  });

  it('reads apiBasePath from user config file', async () => {
    const configFile = writeTempConfigFile({ apiBasePath: 'api' });
    const cfg = await runWithProvider(new Map(), { REMNOTE_CONFIG_FILE: configFile });
    expect(cfg.apiBasePath).toBe('/api');
  });

  it('prefers env apiHost and apiBasePath over user config file', async () => {
    const configFile = writeTempConfigFile({ apiHost: '127.0.0.1', apiBasePath: '/api' });
    const cfg = await runWithProvider(new Map(), {
      REMNOTE_CONFIG_FILE: configFile,
      REMNOTE_API_HOST: '0.0.0.0',
      REMNOTE_API_BASE_PATH: '/v2',
    });
    expect(cfg.apiHost).toBe('0.0.0.0');
    expect(cfg.apiBasePath).toBe('/v2');
  });

  it('prefers cli apiHost apiPort and apiBasePath over env and user config file', async () => {
    const configFile = writeTempConfigFile({ apiHost: '127.0.0.1', apiPort: 3001, apiBasePath: '/api' });
    const cfg = await runWithProvider(
      new Map([
        ['apiHost', 'localhost'],
        ['apiPort', '3020'],
        ['apiBasePath', 'v3'],
      ]),
      {
        REMNOTE_CONFIG_FILE: configFile,
        REMNOTE_API_HOST: '0.0.0.0',
        REMNOTE_API_PORT: '3010',
        REMNOTE_API_BASE_PATH: '/v2',
      },
    );
    expect(cfg.apiHost).toBe('localhost');
    expect(cfg.apiPort).toBe(3020);
    expect(cfg.apiBasePath).toBe('/v3');
  });

  it('reads nested api.host and api.basePath from user config file', async () => {
    const configFile = writeTempConfigFile({ api: { host: 'localhost', basePath: 'v3' } });
    const cfg = await runWithProvider(new Map(), { REMNOTE_CONFIG_FILE: configFile });
    expect(cfg.apiHost).toBe('localhost');
    expect(cfg.apiBasePath).toBe('/v3');
  });
  it('reads nested api.port from user config file', async () => {
    const configFile = writeTempConfigFile({ api: { port: 3002 } });
    const cfg = await runWithProvider(new Map(), { REMNOTE_CONFIG_FILE: configFile });
    expect(cfg.apiPort).toBe(3002);
  });
});
