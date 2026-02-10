import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { Queue } from '../../services/Queue.js';
import { writeFailure, writeSuccess } from '../_shared.js';

export const queueConflictsCommand = Command.make(
  'conflicts',
  {
    limit: Options.integer('limit').pipe(Options.withDefault(500)),
    maxClusters: Options.integer('max-clusters').pipe(Options.withDefault(50)),
    top: Options.integer('top').pipe(Options.withDefault(10)),
  },
  ({ limit, maxClusters, top }) =>
    Effect.gen(function* () {
      if (!Number.isFinite(limit) || limit <= 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--limit must be a positive integer',
            exitCode: 2,
            details: { limit },
          }),
        );
      }
      if (!Number.isFinite(maxClusters) || maxClusters <= 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--max-clusters must be a positive integer',
            exitCode: 2,
            details: { max_clusters: maxClusters },
          }),
        );
      }
      if (!Number.isFinite(top) || top < 0) {
        return yield* Effect.fail(
          new CliError({
            code: 'INVALID_ARGS',
            message: '--top must be a non-negative integer',
            exitCode: 2,
            details: { top },
          }),
        );
      }

      const cfg = yield* AppConfig;
      const queue = yield* Queue;
      const result = yield* queue.conflicts({ dbPath: cfg.storeDb, limit, maxClusters });

      const clusters = Array.isArray((result as any)?.clusters) ? ((result as any).clusters as any[]) : [];
      const showN = Math.max(0, Math.min(Math.floor(top), clusters.length));

      const highRisk = clusters.filter((c) => String(c?.risk ?? '') === 'high').length;
      const mediumRisk = clusters.filter((c) => String(c?.risk ?? '') === 'medium').length;

      const lines: string[] = [
        `- scanned_ops: ${String((result as any).scanned_ops ?? '')}`,
        `- truncated: ${String((result as any).truncated ?? '')}`,
        `- clusters_total: ${String((result as any).clusters_total ?? '')}`,
        `- clusters_returned: ${String((result as any).clusters_returned ?? '')}`,
        `- high_risk: ${highRisk}`,
        `- medium_risk: ${mediumRisk}`,
      ];

      for (const c of clusters.slice(0, showN)) {
        const risk = String(c?.risk ?? '');
        const key = String(c?.conflict_key ?? '');
        const opCount = String(c?.op_count ?? '');
        const txnCount = String(c?.txn_count ?? '');
        const types = Array.isArray(c?.op_types) ? (c.op_types as any[]).map((t) => String(t ?? '')).filter(Boolean) : [];
        const note = typeof c?.note === 'string' ? c.note.trim() : '';
        lines.push(`- [${risk}] ${key} (ops=${opCount} txns=${txnCount} types=${types.join(',')})${note ? ` — ${note}` : ''}`);
      }

      yield* writeSuccess({ data: result, md: `${lines.join('\n')}\n` });
    }).pipe(Effect.catchAll(writeFailure)),
);
