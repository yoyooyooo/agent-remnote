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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-remnote-config-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  return file;
}

describe('Config apiBaseUrl (unit)', () => {
  it('defaults apiBaseUrl to undefined', async () => {
    const cfg = await runWithProvider(new Map(), {});
    expect(cfg.apiBaseUrl).toBeUndefined();
  });

  it('reads apiBaseUrl from user config file', async () => {
    const configFile = writeTempConfigFile({ apiBaseUrl: 'http://host.docker.internal:3000' });
    const cfg = await runWithProvider(new Map(), { REMNOTE_CONFIG_FILE: configFile });
    expect(cfg.apiBaseUrl).toBe('http://host.docker.internal:3000');
  });

  it('reads apiBaseUrl from env', async () => {
    const cfg = await runWithProvider(new Map(), { REMNOTE_API_BASE_URL: 'http://host.docker.internal:3000' });
    expect(cfg.apiBaseUrl).toBe('http://host.docker.internal:3000');
  });

  it('prefers env apiBaseUrl over user config file', async () => {
    const configFile = writeTempConfigFile({ apiBaseUrl: 'http://127.0.0.1:3001' });
    const cfg = await runWithProvider(new Map(), {
      REMNOTE_CONFIG_FILE: configFile,
      REMNOTE_API_BASE_URL: 'http://host.docker.internal:3000',
    });
    expect(cfg.apiBaseUrl).toBe('http://host.docker.internal:3000');
  });

  it('prefers CLI apiBaseUrl over env', async () => {
    const cfg = await runWithProvider(new Map([['apiBaseUrl', 'http://127.0.0.1:3001']]), {
      REMNOTE_API_BASE_URL: 'http://host.docker.internal:3000',
    });
    expect(cfg.apiBaseUrl).toBe('http://127.0.0.1:3001');
  });
});
