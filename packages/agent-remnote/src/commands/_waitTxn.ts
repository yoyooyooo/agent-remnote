import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../services/AppConfig.js';
import { CliError } from '../services/Errors.js';
import { Queue } from '../services/Queue.js';

type TxnProgressStatus = 'ready' | 'in_progress' | 'succeeded' | 'failed' | 'aborted' | 'unknown';

function normalizeTxnStatus(raw: unknown): TxnProgressStatus {
  const s = typeof raw === 'string' ? raw.trim() : '';
  switch (s) {
    case 'ready':
    case 'in_progress':
    case 'succeeded':
    case 'failed':
    case 'aborted':
      return s;
    default:
      return 'unknown';
  }
}

function countByStatus(ops: readonly any[], status: string): number {
  return ops.filter((o) => String(o?.status || '') === status).length;
}

export type WaitTxnResult = {
  readonly txn_id: string;
  readonly status: TxnProgressStatus;
  readonly ops_total: number;
  readonly ops_succeeded: number;
  readonly ops_failed: number;
  readonly ops_dead: number;
  readonly ops_in_flight: number;
  readonly score: number;
  readonly is_done: boolean;
  readonly is_success: boolean;
  readonly elapsed_ms: number;
  readonly last_update_at?: number | undefined;
};

export function waitForTxn(params: {
  readonly txnId: string;
  readonly timeoutMs?: number | undefined;
  readonly pollMs?: number | undefined;
}): Effect.Effect<WaitTxnResult, CliError, AppConfig | Queue> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const queue = yield* Queue;

    const resolvedTimeoutMs = params.timeoutMs ?? 60_000;
    const resolvedPollMs = params.pollMs ?? 500;

    if (!Number.isFinite(resolvedTimeoutMs) || resolvedTimeoutMs < 0) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: '--timeout-ms must be a non-negative integer (ms)',
          exitCode: 2,
          details: { timeout_ms: resolvedTimeoutMs },
        }),
      );
    }
    if (!Number.isFinite(resolvedPollMs) || resolvedPollMs <= 0) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: '--poll-ms must be a positive integer (ms)',
          exitCode: 2,
          details: { poll_ms: resolvedPollMs },
        }),
      );
    }

    const startedAt = Date.now();
    const deadline = startedAt + resolvedTimeoutMs;

    while (true) {
      const inspected = yield* queue.inspect({ dbPath: cfg.storeDb, txnId: params.txnId });
      const ops = Array.isArray((inspected as any).ops) ? ((inspected as any).ops as any[]) : [];
      const txnRow = (inspected as any).txn ?? {};

      const opsTotal = ops.length;
      const opsSucceeded = countByStatus(ops, 'succeeded');
      const opsDead = countByStatus(ops, 'dead');
      const opsInFlight = countByStatus(ops, 'in_flight');
      const opsPending = countByStatus(ops, 'pending');
      const opsFailed = ops.filter((o) => String(o?.status || '') === 'pending' && Number(o?.attempts ?? 0) > 0).length;

      const score =
        opsTotal > 0 ? Math.max(0, Math.min(100, Math.floor((100 * (opsSucceeded + opsDead)) / opsTotal))) : 0;

      const status = normalizeTxnStatus(txnRow.status);
      const isDone = status === 'succeeded' || status === 'failed' || status === 'aborted';
      const isSuccess = status === 'succeeded' && opsDead === 0;

      const lastUpdateAtRaw = Number(txnRow.updated_at ?? 0);
      const lastUpdateAt = Number.isFinite(lastUpdateAtRaw) && lastUpdateAtRaw > 0 ? Math.floor(lastUpdateAtRaw) : 0;

      if (isDone) {
        if (isSuccess) {
          const data: WaitTxnResult = {
            txn_id: String(txnRow.txn_id ?? params.txnId),
            status,
            ops_total: opsTotal,
            ops_succeeded: opsSucceeded,
            ops_failed: opsFailed,
            ops_dead: opsDead,
            ops_in_flight: opsInFlight,
            score,
            is_done: true,
            is_success: true,
            elapsed_ms: Date.now() - startedAt,
            last_update_at: lastUpdateAt || undefined,
          };
          return data;
        }

        return yield* Effect.fail(
          new CliError({
            code: 'TXN_FAILED',
            message: `Transaction finished with status=${status}`,
            exitCode: 1,
            details: {
              txn_id: String(txnRow.txn_id ?? params.txnId),
              status,
              ops_total: opsTotal,
              ops_succeeded: opsSucceeded,
              ops_failed: opsFailed,
              ops_dead: opsDead,
              ops_in_flight: opsInFlight,
              ops_pending: opsPending,
              score,
              elapsed_ms: Date.now() - startedAt,
              last_update_at: lastUpdateAt || undefined,
            },
            hint: [
              `agent-remnote queue inspect --txn ${String(txnRow.txn_id ?? params.txnId)}`,
              'agent-remnote daemon status',
              'agent-remnote daemon logs',
            ],
          }),
        );
      }

      if (Date.now() >= deadline) {
        return yield* Effect.fail(
          new CliError({
            code: 'TXN_TIMEOUT',
            message: `Timed out waiting for transaction to finish (${resolvedTimeoutMs}ms)`,
            exitCode: 1,
            details: {
              txn_id: String(txnRow.txn_id ?? params.txnId),
              status,
              ops_total: opsTotal,
              ops_succeeded: opsSucceeded,
              ops_failed: opsFailed,
              ops_dead: opsDead,
              ops_in_flight: opsInFlight,
              ops_pending: opsPending,
              score,
              elapsed_ms: Date.now() - startedAt,
              last_update_at: lastUpdateAt || undefined,
            },
            hint: [
              `agent-remnote queue progress --txn ${String(txnRow.txn_id ?? params.txnId)}`,
              `agent-remnote queue inspect --txn ${String(txnRow.txn_id ?? params.txnId)}`,
              'agent-remnote daemon status',
              'agent-remnote daemon sync',
              'agent-remnote daemon restart',
            ],
          }),
        );
      }

      yield* Effect.sleep(Duration.millis(resolvedPollMs));
    }
  });
}
