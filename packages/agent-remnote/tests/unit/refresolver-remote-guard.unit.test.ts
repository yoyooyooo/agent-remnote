import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { AppConfig } from '../../src/services/AppConfig.js';
import type { ResolvedConfig } from '../../src/services/Config.js';
import { RefResolver, RefResolverLive } from '../../src/services/RefResolver.js';

function makeConfig(apiBaseUrl?: string): ResolvedConfig {
  return {
    format: 'json',
    quiet: true,
    debug: false,
    configFile: '/tmp/config.json',
    remnoteDb: undefined,
    storeDb: '/tmp/store.sqlite',
    wsUrl: 'ws://localhost:6789/ws',
    wsScheduler: true,
    wsDispatchMaxBytes: 512_000,
    wsDispatchMaxOpBytes: 256_000,
    repo: undefined,
    wsStateFile: { disabled: false, path: '/tmp/ws.bridge.state.json' },
    wsStateStaleMs: 60_000,
    tmuxRefresh: false,
    tmuxRefreshMinIntervalMs: 250,
    statusLineFile: '/tmp/status-line.txt',
    statusLineMinIntervalMs: 250,
    statusLineDebug: false,
    statusLineJsonFile: '/tmp/status-line.json',
    apiBaseUrl,
    apiHost: '127.0.0.1',
    apiPort: 3310,
    apiBasePath: '/v1',
    apiPidFile: '/tmp/api.pid',
    apiLogFile: '/tmp/api.log',
    apiStateFile: '/tmp/api.state.json',
  };
}

describe('RefResolver remote guard (unit)', () => {
  it('allows pure id refs when apiBaseUrl is configured', async () => {
    const cfgLayer = Layer.succeed(AppConfig, makeConfig('http://host.docker.internal:3310'));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const refs = yield* RefResolver;
        return yield* refs.resolve('id:RID-1');
      }).pipe(Effect.provide([cfgLayer, RefResolverLive])),
    );

    expect(result).toBe('RID-1');
  });

  it('fails fast for db-backed refs when apiBaseUrl is configured', async () => {
    const cfgLayer = Layer.succeed(AppConfig, makeConfig('http://host.docker.internal:3310'));
    const result = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const refs = yield* RefResolver;
          return yield* refs.resolve('daily:today');
        }).pipe(Effect.provide([cfgLayer, RefResolverLive])),
      ),
    );

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.code).toBe('INVALID_ARGS');
      expect(result.left.message).toContain('apiBaseUrl');
    }
  });
});
