import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError } from '../../services/Errors.js';
import { WsClient } from '../../services/WsClient.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { API_START_WAIT_DEFAULT_MS, ensureApiDaemon } from '../api/_shared.js';
import { ensureWsSupervisor, WS_START_WAIT_DEFAULT_MS } from '../ws/_shared.js';

const workerTimeoutMs = Options.integer('worker-timeout-ms').pipe(Options.withDefault(15_000));

function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function waitForActiveWorker(params: {
  readonly timeoutMs: number;
}): Effect.Effect<string, CliError, AppConfig | WsClient> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const ws = yield* WsClient;
    const deadline = Date.now() + clampPositiveInt(params.timeoutMs, 15_000);

    while (Date.now() < deadline) {
      const res = yield* ws.queryClients({ url: cfg.wsUrl, timeoutMs: 2000 }).pipe(Effect.either);
      if (res._tag === 'Right') {
        const active = typeof res.right.activeWorkerConnId === 'string' ? res.right.activeWorkerConnId.trim() : '';
        if (active) return active;
      }
      yield* Effect.sleep(300);
    }

    return yield* Effect.fail(
      new CliError({
        code: 'WS_TIMEOUT',
        message: `Timed out waiting for an active worker (${params.timeoutMs}ms)`,
        exitCode: 1,
        details: { timeout_ms: params.timeoutMs, ws_url: cfg.wsUrl },
        hint: [
          'Switch to the target RemNote window to trigger a selection or focus update',
          'agent-remnote daemon status --json',
          'agent-remnote daemon logs --lines 200',
        ],
      }),
    );
  });
}

export const stackEnsureCommand = Command.make(
  'ensure',
  {
    waitWorker: Options.boolean('wait-worker'),
    workerTimeoutMs,
  },
  ({ waitWorker, workerTimeoutMs }) =>
    Effect.gen(function* () {
      const daemon = yield* ensureWsSupervisor({ waitMs: WS_START_WAIT_DEFAULT_MS });
      const api = yield* ensureApiDaemon({ waitMs: API_START_WAIT_DEFAULT_MS });
      const activeWorkerConnId = waitWorker ? yield* waitForActiveWorker({ timeoutMs: workerTimeoutMs }) : undefined;

      yield* writeSuccess({
        data: { daemon, api, active_worker_conn_id: activeWorkerConnId ?? null },
        md: [
          `- daemon_started: ${daemon.started}`,
          `- daemon_pid: ${daemon.pid ?? ''}`,
          `- daemon_pid_file: ${daemon.pid_file}`,
          `- api_started: ${api.started}`,
          `- api_pid: ${api.pid ?? ''}`,
          `- api_pid_file: ${api.pid_file}`,
          `- api_base_url: ${api.base_url}`,
          `- active_worker_conn_id: ${activeWorkerConnId ?? ''}`,
        ].join('\n'),
      });
    }).pipe(Effect.catchAll(writeFailure)),
);
