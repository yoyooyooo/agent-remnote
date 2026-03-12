import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { HostApiClient, HostApiClientLive } from '../../src/services/HostApiClient.js';
import { AppConfig } from '../../src/services/AppConfig.js';
import type { ResolvedConfig } from '../../src/services/Config.js';

type FetchMock = ReturnType<typeof vi.fn>;

function mockJsonResponse(payload: unknown): Response {
  return {
    json: async () => payload,
  } as Response;
}

async function runWithClient<A>(fn: (client: typeof HostApiClient.Service) => Effect.Effect<A, any>) {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* HostApiClient;
      return yield* fn(client);
    }).pipe(Effect.provide(hostApiClientTestLayer())),
  );
}

function makeConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
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
    apiBaseUrl: undefined,
    apiHost: '127.0.0.1',
    apiPort: 3310,
    apiBasePath: '/v1',
    apiPidFile: '/tmp/api.pid',
    apiLogFile: '/tmp/api.log',
    apiStateFile: '/tmp/api.state.json',
    ...overrides,
  };
}

function hostApiClientTestLayer(overrides?: Partial<ResolvedConfig>) {
  return HostApiClientLive.pipe(Layer.provide(Layer.succeed(AppConfig, makeConfig(overrides))));
}

describe('HostApiClient (unit)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('posts readOutline requests to the host api', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      mockJsonResponse({
        ok: true,
        data: { markdown: '# Remote Outline' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await runWithClient((client) =>
      client.readOutline({
        baseUrl: 'http://host.docker.internal:3310',
        body: { ref: 'daily:today', depth: 3, format: 'md' },
      }),
    );

    expect(data).toEqual({ markdown: '# Remote Outline' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://host.docker.internal:3310/v1/read/outline',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ref: 'daily:today', depth: 3, format: 'md' }),
      }),
    );
  });

  it('queries dailyRemId through the host api', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      mockJsonResponse({
        ok: true,
        data: { ref: 'daily:today', remId: 'D1', dateString: '2026/03/11' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await runWithClient((client) =>
      client.dailyRemId({
        baseUrl: 'http://host.docker.internal:3310',
        offsetDays: 0,
      }),
    );

    expect(data).toEqual({ ref: 'daily:today', remId: 'D1', dateString: '2026/03/11' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://host.docker.internal:3310/v1/daily/rem-id?offsetDays=0',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('uses configured apiBasePath when baseUrl has no path prefix', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      mockJsonResponse({
        ok: true,
        data: { markdown: '# Remote Outline' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* HostApiClient;
        return yield* client.readOutline({
          baseUrl: 'http://host.docker.internal:3310',
          body: { ref: 'daily:today', depth: 3, format: 'md' },
        });
      }).pipe(Effect.provide(hostApiClientTestLayer({ apiBasePath: '/remnote/v1' }))),
    );

    expect(data).toEqual({ markdown: '# Remote Outline' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://host.docker.internal:3310/remnote/v1/read/outline',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('prefers apiBaseUrl path prefix over configured apiBasePath', async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      mockJsonResponse({
        ok: true,
        data: { ref: 'daily:today', remId: 'D1', dateString: '2026/03/11' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* HostApiClient;
        return yield* client.dailyRemId({
          baseUrl: 'http://host.docker.internal:3310/custom/api',
          offsetDays: 0,
        });
      }).pipe(Effect.provide(hostApiClientTestLayer({ apiBasePath: '/ignored' }))),
    );

    expect(data).toEqual({ ref: 'daily:today', remId: 'D1', dateString: '2026/03/11' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://host.docker.internal:3310/custom/api/daily/rem-id?offsetDays=0',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });
});
