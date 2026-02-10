import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';

import { renderStatusLine, type StatusLineModel } from '../../kernel/status-line/index.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { Queue } from '../../services/Queue.js';
import { StatusLineFile } from '../../services/StatusLineFile.js';
import { Tmux } from '../../services/Tmux.js';
import { WsBridgeState } from '../../services/WsBridgeState.js';

export type StatusLineSource = 'daemon' | 'cli_fallback';

function toNonNegativeInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function safeQueueOutstandingCount(stats: unknown): number {
  if (!stats || typeof stats !== 'object') return 0;
  const anyStats = stats as any;
  const pending = toNonNegativeInt(anyStats.pending);
  const inFlight = toNonNegativeInt(anyStats.in_flight ?? anyStats.in_progress);
  return pending + inFlight;
}

export function updateStatusLine(params: {
  readonly source: StatusLineSource;
}): Effect.Effect<
  { readonly text: string; readonly wrote: boolean },
  CliError,
  AppConfig | Queue | WsBridgeState | StatusLineFile | Tmux
> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const queue = yield* Queue;
    const wsState = yield* WsBridgeState;
    const statusLineFile = yield* StatusLineFile;
    const tmux = yield* Tmux;

    const now = yield* Clock.currentTimeMillis;

    const wsSummary = yield* wsState
      .readSummary()
      .pipe(Effect.catchAll(() => Effect.succeed({ connection: 'down', selection: { kind: 'none' } } as const)));

    const queueOutstanding = safeQueueOutstandingCount(
      yield* queue.stats({ dbPath: cfg.storeDb }).pipe(Effect.catchAll(() => Effect.succeed(null))),
    );

    const model: StatusLineModel = {
      connection: wsSummary.connection,
      selection: wsSummary.selection,
      queueOutstanding,
    };

    const text = renderStatusLine(model);

    const json =
      cfg.statusLineDebug === true
        ? {
            updatedAt: now,
            source: params.source,
            connection: model.connection,
            selected: model.selection,
            queueOutstanding,
          }
        : undefined;

    const writeResult = yield* statusLineFile.write({
      text,
      textFilePath: cfg.statusLineFile,
      debug: cfg.statusLineDebug,
      jsonFilePath: cfg.statusLineJsonFile,
      json,
    });

    if (writeResult.wrote) {
      yield* tmux.requestRefresh('coalesced');
    }

    return { text, wrote: writeResult.wrote };
  });
}
