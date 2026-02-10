import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';

import { AppConfig } from '../../services/AppConfig.js';
import type { CliError } from '../../services/Errors.js';

import type { StatusLineSource } from './updateStatusLine.js';
import { StatusLineUpdater } from './StatusLineUpdater.js';

export type StatusLineInvalidateParams = {
  readonly source: StatusLineSource;
  readonly reason?: string | undefined;
};

export interface StatusLineControllerService {
  readonly invalidate: (params: StatusLineInvalidateParams) => Effect.Effect<void, CliError>;
}

export class StatusLineController extends Context.Tag('StatusLineController')<
  StatusLineController,
  StatusLineControllerService
>() {}

type ControllerState = {
  readonly scheduled: boolean;
  readonly pending: boolean;
  readonly source: StatusLineSource;
  readonly lastWriteAt: number;
  readonly waiters: ReadonlyArray<Deferred.Deferred<void, CliError>>;
};

const INITIAL_STATE: ControllerState = {
  scheduled: false,
  pending: false,
  source: 'cli_fallback',
  lastWriteAt: 0,
  waiters: [],
};

function mergeSource(a: StatusLineSource, b: StatusLineSource): StatusLineSource {
  return a === 'daemon' || b === 'daemon' ? 'daemon' : 'cli_fallback';
}

export const StatusLineControllerLive = Layer.scoped(
  StatusLineController,
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const updater = yield* StatusLineUpdater;
    const state = yield* Ref.make(INITIAL_STATE);

    const runLoop = Effect.gen(function* () {
      while (true) {
        const snapBefore = yield* Ref.get(state);
        if (!snapBefore.pending) {
          yield* Ref.update(state, (s) => ({ ...s, scheduled: false }));
          return;
        }

        const now = yield* Clock.currentTimeMillis;
        const elapsed = now - snapBefore.lastWriteAt;
        const minIntervalMs = Math.max(0, cfg.statusLineMinIntervalMs);
        const delay = elapsed >= minIntervalMs ? 0 : minIntervalMs - elapsed;
        if (delay > 0) yield* Effect.sleep(delay);

        const batch = yield* Ref.modify(state, (s) => {
          if (!s.pending) {
            return [null, s] as const;
          }
          return [
            { source: s.source, waiters: s.waiters },
            { ...s, pending: false, source: 'cli_fallback', waiters: [] },
          ] as const;
        });

        if (!batch) continue;

        const updated = yield* updater.update({ source: batch.source }).pipe(Effect.either);
        if (updated._tag === 'Left') {
          for (const w of batch.waiters) yield* Deferred.fail(w, updated.left);
          yield* Ref.update(state, (s) => ({ ...s, scheduled: false, pending: false }));
          return;
        }

        const wroteAt = yield* Clock.currentTimeMillis;
        yield* Ref.update(state, (s) => ({ ...s, lastWriteAt: wroteAt }));
        for (const w of batch.waiters) yield* Deferred.succeed(w, undefined);
      }
    });

    return {
      invalidate: ({ source }) =>
        Effect.gen(function* () {
          const waiter = yield* Deferred.make<void, CliError>();
          const shouldStart = yield* Ref.modify(state, (s) => {
            const next: ControllerState = {
              ...s,
              scheduled: s.scheduled || true,
              pending: true,
              source: mergeSource(s.source, source),
              waiters: [...s.waiters, waiter],
            };
            return [s.scheduled === false, next] as const;
          });

          if (shouldStart) {
            yield* Effect.fork(runLoop.pipe(Effect.catchAll(() => Effect.void)));
          }

          yield* Deferred.await(waiter);
        }),
    } satisfies StatusLineControllerService;
  }),
);
