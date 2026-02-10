import { describe, expect, it } from 'vitest';

import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as TestClock from 'effect/TestClock';
import * as TestContext from 'effect/TestContext';

import { AppConfig } from '../../src/services/AppConfig.js';
import type { ResolvedConfig } from '../../src/services/Config.js';
import { StatusLineController, StatusLineControllerLive } from '../../src/runtime/status-line/StatusLineController.js';
import { StatusLineUpdater } from '../../src/runtime/status-line/StatusLineUpdater.js';

function makeTestConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  const wsScheduler = overrides?.wsScheduler ?? true;
  return {
    format: 'md',
    quiet: true,
    debug: false,
    remnoteDb: undefined,
    storeDb: '/tmp/store.sqlite',
    wsUrl: 'ws://localhost:6789/ws',
    repo: undefined,
    wsStateFile: { disabled: false, path: '/tmp/ws.bridge.state.json' },
    wsStateStaleMs: 60_000,
    tmuxRefresh: false,
    tmuxRefreshMinIntervalMs: 250,
    statusLineFile: '/tmp/status-line.txt',
    statusLineMinIntervalMs: 1000,
    statusLineDebug: false,
    statusLineJsonFile: '/tmp/status-line.json',
    wsDispatchMaxBytes: 512_000,
    wsDispatchMaxOpBytes: 256_000,
    ...overrides,
    wsScheduler,
  };
}

const testClockLayer = TestClock.defaultTestClock.pipe(Layer.provide(TestContext.TestContext));

describe('StatusLineController (unit)', () => {
  it('coalesces invalidations and respects min interval (TestClock)', async () => {
    const calls: Array<{ source: 'daemon' | 'cli_fallback' }> = [];

    const cfgLayer = Layer.succeed(AppConfig, makeTestConfig({ statusLineMinIntervalMs: 1000 }));
    const updaterLayer = Layer.succeed(StatusLineUpdater, {
      update: ({ source }) =>
        Effect.sync(() => {
          calls.push({ source });
          return { text: '', wrote: true } as const;
        }),
    });
    const controllerLayer = StatusLineControllerLive.pipe(Layer.provide([cfgLayer, updaterLayer]));

    const program = Effect.gen(function* () {
      const ctl = yield* StatusLineController;

      yield* TestClock.setTime(100_000);

      // First invalidate: should run immediately.
      yield* ctl.invalidate({ source: 'cli_fallback' });
      yield* Effect.sync(() => expect(calls).toEqual([{ source: 'cli_fallback' }]));

      // Two invalidations within min interval should be coalesced into one update, with source merged to 'daemon'.
      const f1 = yield* ctl.invalidate({ source: 'cli_fallback' }).pipe(Effect.fork);
      const f2 = yield* ctl.invalidate({ source: 'daemon' }).pipe(Effect.fork);

      yield* TestClock.adjust(999);
      yield* Effect.sync(() => expect(calls).toHaveLength(1));

      yield* TestClock.adjust(1);

      yield* Fiber.join(f1);
      yield* Fiber.join(f2);

      yield* Effect.sync(() => expect(calls).toEqual([{ source: 'cli_fallback' }, { source: 'daemon' }]));
    }).pipe(Effect.provide(testClockLayer), Effect.provide(controllerLayer));

    await Effect.runPromise(Effect.scoped(program));
  });
});
