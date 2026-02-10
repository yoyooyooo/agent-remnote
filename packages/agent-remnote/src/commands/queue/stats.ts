import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../services/AppConfig.js';
import { Queue } from '../../services/Queue.js';
import { writeFailure, writeSuccess } from '../_shared.js';

export const queueStatsCommand = Command.make(
  'stats',
  { includeConflicts: Options.boolean('include-conflicts') },
  ({ includeConflicts }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const queue = yield* Queue;
      const result = yield* queue.stats({ dbPath: cfg.storeDb });

      const conflictsSummary = includeConflicts
        ? yield* queue.conflicts({ dbPath: cfg.storeDb, limit: 200, maxClusters: 20 }).pipe(
            Effect.map((report) => {
              const clusters = Array.isArray((report as any)?.clusters) ? ((report as any).clusters as any[]) : [];
              const highRisk = clusters.filter((c) => String(c?.risk ?? '') === 'high').length;
              const mediumRisk = clusters.filter((c) => String(c?.risk ?? '') === 'medium').length;
              return {
                scanned_ops: (report as any).scanned_ops ?? null,
                truncated: (report as any).truncated ?? null,
                clusters_total: (report as any).clusters_total ?? null,
                clusters_returned: (report as any).clusters_returned ?? null,
                high_risk: highRisk,
                medium_risk: mediumRisk,
                warnings: (report as any).warnings ?? undefined,
                nextActions: (report as any).nextActions ?? undefined,
              };
            }),
          )
        : undefined;

      const data = includeConflicts ? ({ ...result, conflicts_summary: conflictsSummary } as any) : result;

      const mdLines = [
        `- pending: ${(result as any).pending ?? ''}`,
        `- in_flight: ${(result as any).in_flight ?? ''}`,
        `- dead: ${(result as any).dead ?? ''}`,
        `- ready_txns: ${(result as any).ready_txns ?? ''}`,
      ];
      if (conflictsSummary) {
        mdLines.push(
          `- conflicts_scanned_ops: ${(conflictsSummary as any).scanned_ops ?? ''}`,
          `- conflicts_truncated: ${(conflictsSummary as any).truncated ?? ''}`,
          `- conflicts_clusters_total: ${(conflictsSummary as any).clusters_total ?? ''}`,
          `- conflicts_high_risk: ${(conflictsSummary as any).high_risk ?? ''}`,
          `- conflicts_medium_risk: ${(conflictsSummary as any).medium_risk ?? ''}`,
        );
      }

      yield* writeSuccess({ data, md: `${mdLines.join('\n')}\n` });
    }).pipe(Effect.catchAll(writeFailure)),
);
