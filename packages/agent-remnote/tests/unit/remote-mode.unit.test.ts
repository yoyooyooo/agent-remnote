import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { remoteModeUnsupportedError, failInRemoteMode } from '../../src/commands/_remoteMode.js';
import { AppConfig } from '../../src/services/AppConfig.js';
import type { ResolvedConfig } from '../../src/services/Config.js';

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

describe('remote mode guard (unit)', () => {
  it('builds a stable INVALID_ARGS error', () => {
    const error = remoteModeUnsupportedError({
      command: 'table show',
      reason: 'this command still reads local metadata',
      apiBaseUrl: 'http://host.docker.internal:3310',
    });

    expect(error.code).toBe('INVALID_ARGS');
    expect(error.exitCode).toBe(2);
    expect(error.details).toMatchObject({
      command: 'table show',
      api_base_url: 'http://host.docker.internal:3310',
    });
  });

  it('fails when apiBaseUrl is configured', async () => {
    const cfgLayer = Layer.succeed(AppConfig, makeConfig('http://host.docker.internal:3310'));
    const result = await Effect.runPromise(
      Effect.either(
        failInRemoteMode({
          command: 'table show',
          reason: 'this command still reads local metadata',
        }).pipe(Effect.provide(cfgLayer)),
      ),
    );

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.code).toBe('INVALID_ARGS');
      expect(result.left.message).toContain('apiBaseUrl');
    }
  });

  it('is a no-op when apiBaseUrl is not configured', async () => {
    const cfgLayer = Layer.succeed(AppConfig, makeConfig(undefined));
    const result = await Effect.runPromise(
      failInRemoteMode({
        command: 'table show',
        reason: 'this command still reads local metadata',
      }).pipe(Effect.provide(cfgLayer)),
    );

    expect(result).toBeUndefined();
  });
});
