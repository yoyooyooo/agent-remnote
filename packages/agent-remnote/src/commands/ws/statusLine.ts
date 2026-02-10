import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { writeFailure, writeSuccess } from '../_shared.js';
import { AppConfig } from '../../services/AppConfig.js';
import { FsAccess } from '../../services/FsAccess.js';
import { Queue } from '../../services/Queue.js';
import { pickClient, readJson, resolveStateFilePath, resolveStaleMs } from './bridgeState.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));

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

export const wsStatusLineCommand = Command.make('status-line', { stateFile, staleMs }, ({ stateFile, staleMs }) =>
  Effect.gen(function* () {
    const resolved = resolveStateFilePath(stateFile);
    if (resolved.disabled) {
      return yield* writeSuccess({
        data: { status: 'off', state_file: resolved.path },
        md: '',
      });
    }

    const state = readJson(resolved.path);
    if (!state) {
      return yield* writeSuccess({
        data: { status: 'down', state_file: resolved.path },
        md: '',
      });
    }

    const now = Date.now();
    const updatedAt = Number(state.updatedAt ?? 0);
    const staleThreshold = resolveStaleMs(staleMs);
    const isStale = !Number.isFinite(updatedAt) || updatedAt <= 0 || now - updatedAt > staleThreshold;

    const clients = Array.isArray(state.clients) ? state.clients : [];
    const activeConnId = typeof state.activeWorkerConnId === 'string' ? state.activeWorkerConnId : undefined;
    const client = pickClient(clients, activeConnId);

    // Only show when a client is connected (otherwise show nothing).
    if (!client) {
      return yield* writeSuccess({
        data: { status: 'no_client', updatedAt, now, stale_ms: staleThreshold, clients: clients.length },
        md: '',
      });
    }

    const sel: any = client?.selection;
    const kind = typeof sel?.kind === 'string' ? sel.kind : 'none';
    const selectedRaw = kind === 'rem' ? Number(sel?.totalCount ?? 0) : kind === 'text' ? 1 : 0;
    const selectedCount = Number.isFinite(selectedRaw) && selectedRaw >= 0 ? Math.floor(selectedRaw) : 0;

    if (isStale) {
      return yield* writeSuccess({
        data: {
          status: 'stale',
          updatedAt,
          now,
          stale_ms: staleThreshold,
          clients: clients.length,
          selected: selectedCount,
        },
        md: '',
      });
    }

    const cfg = yield* AppConfig;
    const queue = yield* Queue;
    const fsAccess = yield* FsAccess;

    const stateQueueDbPath = typeof (state as any)?.queue?.dbPath === 'string' ? String((state as any).queue.dbPath) : undefined;
    const stateQueueStats = (state as any)?.queue?.stats;
    const stateQueueStatsOk = !!stateQueueStats && typeof stateQueueStats === 'object';
    const stateQueueOutstanding = stateQueueStatsOk ? safeQueueOutstandingCount(stateQueueStats) : 0;

    const storeDbOk = yield* fsAccess.isFile(cfg.storeDb);
    const queueOutstanding = stateQueueStatsOk
      ? stateQueueOutstanding
      : storeDbOk
        ? safeQueueOutstandingCount(
            yield* queue.stats({ dbPath: cfg.storeDb }).pipe(Effect.catchAll(() => Effect.succeed(null))),
          )
        : 0;
    const queueSource = stateQueueStatsOk ? 'bridge_state' : storeDbOk ? 'cli_store_db' : 'unavailable';

    const queuePart = queueOutstanding > 0 ? `↓${queueOutstanding}` : '';
    const base = kind === 'rem' && selectedCount > 0 ? `${selectedCount} rems` : kind === 'text' ? 'TXT' : 'RN';
    const md = queuePart ? `${base} ${queuePart}` : base;

    return yield* writeSuccess({
      data: {
        status: 'ok',
        updatedAt,
        clients: clients.length,
        selected: selectedCount,
        queue_outstanding: queueOutstanding,
        store_db: stateQueueDbPath ?? cfg.storeDb,
        queue_source: queueSource,
      },
      md,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
