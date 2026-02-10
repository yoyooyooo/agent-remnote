import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../services/AppConfig.js';
import { Queue } from '../../services/Queue.js';
import { writeFailure, writeSuccess } from '../_shared.js';

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

export const queueProgressCommand = Command.make('progress', { txn: Options.text('txn') }, ({ txn }) =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const queue = yield* Queue;

    const inspected = yield* queue.inspect({ dbPath: cfg.storeDb, txnId: txn });
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

    const nextActions: string[] = [];
    if (!isDone && opsInFlight === 0 && opsPending > 0) {
      nextActions.push('agent-remnote daemon sync');
      nextActions.push('agent-remnote daemon status');
    }

    const data = {
      txn_id: String(txnRow.txn_id ?? txn),
      status,
      ops_total: opsTotal,
      ops_succeeded: opsSucceeded,
      ops_failed: opsFailed,
      ops_dead: opsDead,
      ops_in_flight: opsInFlight,
      score,
      is_done: isDone,
      is_success: isSuccess,
      last_update_at: lastUpdateAt || undefined,
      nextActions: nextActions.length > 0 ? nextActions : undefined,
    };

    const md = [
      `- txn_id: ${data.txn_id}`,
      `- status: ${data.status}`,
      `- score: ${data.score}`,
      `- ops_total: ${data.ops_total}`,
      `- ops_succeeded: ${data.ops_succeeded}`,
      `- ops_failed: ${data.ops_failed}`,
      `- ops_dead: ${data.ops_dead}`,
      `- ops_in_flight: ${data.ops_in_flight}`,
      `- is_done: ${data.is_done ? 'true' : 'false'}`,
      `- is_success: ${data.is_success ? 'true' : 'false'}`,
    ].join('\n');

    yield* writeSuccess({ data, md });
  }).pipe(Effect.catchAll(writeFailure)),
);
