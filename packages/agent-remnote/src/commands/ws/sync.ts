import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../services/AppConfig.js';
import { Queue } from '../../services/Queue.js';
import { WsClient } from '../../services/WsClient.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { WS_HEALTH_TIMEOUT_MS, WS_START_WAIT_DEFAULT_MS, ensureWsSupervisor } from './_shared.js';

const ensureDaemon = Options.boolean('no-ensure-daemon').pipe(Options.map((v) => !v));

export const wsSyncCommand = Command.make('sync', { ensureDaemon }, ({ ensureDaemon: ensureDaemonValue }) =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const queue = yield* Queue;
    const ws = yield* WsClient;

    if (ensureDaemonValue) {
      yield* ensureWsSupervisor({ waitMs: WS_START_WAIT_DEFAULT_MS });
    }

    const result = yield* ws.triggerStartSync({
      url: cfg.wsUrl,
      timeoutMs: WS_HEALTH_TIMEOUT_MS,
    });

    const conflictData = yield* queue.stats({ dbPath: cfg.storeDb }).pipe(
      Effect.flatMap((stats) => {
        const pending = Number((stats as any)?.pending ?? 0);
        if (!Number.isFinite(pending) || pending < 2) {
          return Effect.succeed({ stats, summary: undefined as any });
        }
        return queue
          .conflicts({ dbPath: cfg.storeDb, limit: 200, maxClusters: 20 })
          .pipe(Effect.map((report) => ({ stats, summary: report })));
      }),
      Effect.catchAll(() => Effect.succeed({ stats: undefined as any, summary: undefined as any })),
    );

    const warnings: string[] = [];
    const extraNextActions: string[] = [];

    if (conflictData.summary && typeof conflictData.summary === 'object') {
      const clusters = Array.isArray((conflictData.summary as any)?.clusters)
        ? (((conflictData.summary as any).clusters as any[]).filter(Boolean) as any[])
        : [];
      const highRisk = clusters.filter((c) => String(c?.risk ?? '') === 'high').length;
      const mediumRisk = clusters.filter((c) => String(c?.risk ?? '') === 'medium').length;
      if (highRisk > 0) {
        warnings.push(
          `High-risk conflict clusters detected in the queue backlog (high=${highRisk}, medium=${mediumRisk}). Review conflicts before syncing.`,
        );
        extraNextActions.push('agent-remnote queue conflicts');
      }

      const fromReport = Array.isArray((conflictData.summary as any)?.nextActions)
        ? (((conflictData.summary as any).nextActions as any[])
            .map((x) => String(x ?? '').trim())
            .filter(Boolean) as string[])
        : [];
      extraNextActions.push(...fromReport);
    }

    const mergedNextActions: string[] = [];
    for (const a of [...(result.nextActions ?? []), ...extraNextActions]) {
      const s = String(a ?? '').trim();
      if (!s) continue;
      if (!mergedNextActions.includes(s)) mergedNextActions.push(s);
    }

    const data =
      warnings.length > 0 || mergedNextActions.length > 0 || conflictData.summary
        ? ({
            ...result,
            conflicts_summary: conflictData.summary
              ? {
                  scanned_ops: (conflictData.summary as any).scanned_ops ?? null,
                  truncated: (conflictData.summary as any).truncated ?? null,
                  clusters_total: (conflictData.summary as any).clusters_total ?? null,
                  clusters_returned: (conflictData.summary as any).clusters_returned ?? null,
                  warnings: (conflictData.summary as any).warnings ?? undefined,
                }
              : undefined,
            warnings: warnings.length > 0 ? warnings : undefined,
            nextActions: mergedNextActions.length > 0 ? mergedNextActions : undefined,
          } as any)
        : result;

    const md = [`- sent: ${result.sent}`, result.activeConnId ? `- activeConnId: ${result.activeConnId}` : '']
      .filter(Boolean)
      .join('\n');
    yield* writeSuccess({ data, md: `${md}\n` });
  }).pipe(Effect.catchAll(writeFailure)),
);
