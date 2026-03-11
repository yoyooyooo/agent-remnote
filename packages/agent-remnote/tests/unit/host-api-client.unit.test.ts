import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Effect from 'effect/Effect';

import { HostApiClient, HostApiClientLive } from '../../src/services/HostApiClient.js';

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
    }).pipe(Effect.provide(HostApiClientLive)),
  );
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
});
