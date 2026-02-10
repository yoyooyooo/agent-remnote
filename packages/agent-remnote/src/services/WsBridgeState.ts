import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';

import { AppConfig } from './AppConfig.js';
import { CliError, isCliError } from './Errors.js';
import { pickClient } from '../lib/wsState.js';
import type { StatusLineConnection, StatusLineSelection } from '../kernel/status-line/index.js';

export type WsBridgeStateSummary = {
  readonly connection: StatusLineConnection;
  readonly selection: StatusLineSelection;
  readonly updatedAt?: number | undefined;
  readonly clients?: number | undefined;
};

export interface WsBridgeStateService {
  readonly readSummary: () => Effect.Effect<WsBridgeStateSummary, CliError, AppConfig>;
}

export class WsBridgeState extends Context.Tag('WsBridgeState')<WsBridgeState, WsBridgeStateService>() {}

function toNonNegativeInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function normalizeSelection(sel: any): StatusLineSelection {
  const kind = typeof sel?.kind === 'string' ? sel.kind : 'none';
  if (kind === 'text') return { kind: 'text' };
  if (kind === 'rem') {
    const count = toNonNegativeInt(sel?.totalCount ?? sel?.count ?? 0);
    return count > 0 ? { kind: 'rem', count } : { kind: 'none' };
  }
  return { kind: 'none' };
}

export const WsBridgeStateLive = Layer.succeed(WsBridgeState, {
  readSummary: () =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;

      if (cfg.wsStateFile.disabled) {
        return { connection: 'off', selection: { kind: 'none' } } satisfies WsBridgeStateSummary;
      }

      const raw = yield* Effect.tryPromise({
        try: async () => await fs.readFile(cfg.wsStateFile.path, 'utf8'),
        catch: (e: any) => {
          if (e?.code === 'ENOENT') return null;
          return new CliError({
            code: 'INTERNAL',
            message: 'Failed to read ws state file',
            exitCode: 1,
            details: { file: cfg.wsStateFile.path, error: String((e as any)?.message || e) },
          });
        },
      });

      if (raw === null) {
        return {
          connection: 'down',
          selection: { kind: 'none' },
        } satisfies WsBridgeStateSummary;
      }

      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw),
        catch: () =>
          new CliError({
            code: 'INTERNAL',
            message: 'ws state file is not valid JSON',
            exitCode: 1,
            details: { file: cfg.wsStateFile.path },
          }),
      });

      const now = Date.now();
      const updatedAt = Number((parsed as any)?.updatedAt ?? 0);
      const staleMs = cfg.wsStateStaleMs;
      const isStale = !Number.isFinite(updatedAt) || updatedAt <= 0 || now - updatedAt > staleMs;

      const clients = Array.isArray((parsed as any)?.clients) ? (parsed as any).clients : [];
      const activeConnId = typeof (parsed as any)?.activeWorkerConnId === 'string' ? (parsed as any).activeWorkerConnId : undefined;
      const client = pickClient(clients, activeConnId);

      if (!client) {
        return {
          connection: isStale ? 'stale' : 'no_client',
          updatedAt,
          clients: clients.length,
          selection: { kind: 'none' },
        } satisfies WsBridgeStateSummary;
      }

      return {
        connection: isStale ? 'stale' : 'ok',
        updatedAt,
        clients: clients.length,
        selection: normalizeSelection((client as any).selection),
      } satisfies WsBridgeStateSummary;
    }).pipe(
      Effect.catchAll((error) => {
        if (isCliError(error)) return Effect.fail(error);
        return Effect.fail(
          new CliError({
            code: 'INTERNAL',
            message: 'Failed to read ws bridge state',
            exitCode: 1,
            details: { error: String((error as any)?.message || error) },
          }),
        );
      }),
    ),
} satisfies WsBridgeStateService);

