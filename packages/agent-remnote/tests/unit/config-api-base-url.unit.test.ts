import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';

import { buildCliEnvConfigProvider } from '../../src/services/CliConfigProvider.js';
import { resolveConfig } from '../../src/services/Config.js';

function runWithProvider(cli: ReadonlyMap<string, string>, env: NodeJS.ProcessEnv = {}) {
  const provider = buildCliEnvConfigProvider({ cli, env });
  return Effect.runPromise(resolveConfig().pipe(Effect.withConfigProvider(provider)));
}

describe('Config apiBaseUrl (unit)', () => {
  it('defaults apiBaseUrl to undefined', async () => {
    const cfg = await runWithProvider(new Map(), {});
    expect(cfg.apiBaseUrl).toBeUndefined();
  });

  it('reads apiBaseUrl from env', async () => {
    const cfg = await runWithProvider(new Map(), { REMNOTE_API_BASE_URL: 'http://host.docker.internal:3000' });
    expect(cfg.apiBaseUrl).toBe('http://host.docker.internal:3000');
  });

  it('prefers CLI apiBaseUrl over env', async () => {
    const cfg = await runWithProvider(new Map([['apiBaseUrl', 'http://127.0.0.1:3001']]), {
      REMNOTE_API_BASE_URL: 'http://host.docker.internal:3000',
    });
    expect(cfg.apiBaseUrl).toBe('http://127.0.0.1:3001');
  });
});
