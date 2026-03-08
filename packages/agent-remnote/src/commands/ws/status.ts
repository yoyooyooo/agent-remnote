import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Either from 'effect/Either';
import * as Option from 'effect/Option';
import path from 'node:path';

import { AppConfig } from '../../services/AppConfig.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { Process } from '../../services/Process.js';
import { SupervisorState } from '../../services/SupervisorState.js';
import { WsClient } from '../../services/WsClient.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { cleanupStatuslineArtifacts, resolveStatuslineArtifactPaths } from '../../lib/statuslineArtifacts.js';
import { refreshTmuxStatusLine } from '../../lib/tmux.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { WS_HEALTH_TIMEOUT_MS } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));

export const wsStatusCommand = Command.make('status', { pidFile }, ({ pidFile }) =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const daemonFiles = yield* DaemonFiles;
    const proc = yield* Process;
    const supervisorState = yield* SupervisorState;
    const ws = yield* WsClient;

    const pidFilePath = resolveUserFilePath(pidFile ?? daemonFiles.defaultPidFile());

    let pidInfo = yield* daemonFiles.readPidFile(pidFilePath);
    let selfHealCleanup: unknown = undefined;
    if (pidInfo) {
      const alive = yield* proc.isPidRunning(pidInfo.pid);
      if (!alive) {
        const stalePidInfo = pidInfo;
        yield* daemonFiles.deletePidFile(pidFilePath);
        const staleStateFilePath = resolveUserFilePath(
          pidInfo.state_file ?? path.join(path.dirname(pidFilePath), 'ws.state.json'),
        );
        yield* supervisorState.deleteStateFile(staleStateFilePath);
        selfHealCleanup = yield* cleanupStatuslineArtifacts(
          resolveStatuslineArtifactPaths({ cfg, pidInfo: stalePidInfo }),
        );
        yield* Effect.sync(() => refreshTmuxStatusLine());
        pidInfo = undefined;
      }
    }

    const stateFilePath = resolveUserFilePath(
      pidInfo?.state_file ?? path.join(path.dirname(pidFilePath), 'ws.state.json'),
    );
    const state = yield* supervisorState.readStateFile(stateFilePath);

    const mode = pidInfo ? (pidInfo.mode ?? 'legacy') : 'supervisor';
    const supervisorPid = pidInfo?.pid;
    const supervisorRunning = !!pidInfo;

    const childPid =
      mode === 'supervisor'
        ? (pidInfo?.child_pid ?? undefined)
        : // legacy mode: the single pid is the service
          undefined;
    const childRunning = typeof childPid === 'number' ? yield* proc.isPidRunning(childPid) : false;
    const childStartedAt = (pidInfo as any)?.child_started_at as number | undefined;

    const health = yield* ws.health({ url: cfg.wsUrl, timeoutMs: WS_HEALTH_TIMEOUT_MS }).pipe(Effect.either);
    const clientsRes = yield* ws.queryClients({ url: cfg.wsUrl, timeoutMs: WS_HEALTH_TIMEOUT_MS }).pipe(Effect.either);

    const data = {
      service: {
        running: supervisorRunning,
        pid: supervisorPid,
        pid_file: pidFilePath,
        started_at: pidInfo?.started_at,
        log_file: pidInfo?.log_file,
        mode,
        supervisor: { running: supervisorRunning, pid: supervisorPid, started_at: pidInfo?.started_at },
        child: mode === 'supervisor' ? { running: childRunning, pid: childPid, started_at: childStartedAt } : undefined,
      },
      supervisor_state: state,
      self_heal: selfHealCleanup ? { cleaned: true, cleanup: selfHealCleanup } : { cleaned: false },
      ws: {
        url: cfg.wsUrl,
        healthy: Either.isRight(health),
        rtt_ms: Either.isRight(health) ? health.right.rtt_ms : undefined,
        error: Either.isLeft(health) ? health.left.message : undefined,
      },
      active_worker_conn_id: Either.isRight(clientsRes) ? (clientsRes.right.activeWorkerConnId ?? null) : null,
      clients: Either.isRight(clientsRes) ? clientsRes.right.clients : [],
    };

    const md = [
      `- service_running: ${data.service.running}`,
      `- pid: ${data.service.pid ?? ''}`,
      `- pid_file: ${data.service.pid_file}`,
      `- log_file: ${data.service.log_file ?? ''}`,
      `- started_at: ${data.service.started_at ?? ''}`,
      `- mode: ${data.service.mode}`,
      `- supervisor_pid: ${data.service.supervisor.pid ?? ''}`,
      `- child_pid: ${data.service.child?.pid ?? ''}`,
      `- child_running: ${data.service.child?.running ?? ''}`,
      `- restart_count: ${data.supervisor_state?.restart_count ?? ''}`,
      `- supervisor_status: ${data.supervisor_state?.status ?? ''}`,
      `- backoff_until: ${data.supervisor_state?.backoff_until ?? ''}`,
      `- failed_reason: ${data.supervisor_state?.failed_reason ?? ''}`,
      `- ws_url: ${data.ws.url}`,
      `- ws_healthy: ${data.ws.healthy}`,
      `- ws_rtt_ms: ${data.ws.rtt_ms ?? ''}`,
      `- clients: ${data.clients.length}`,
      `- active_worker_conn_id: ${data.active_worker_conn_id ?? ''}`,
    ].join('\n');

    yield* writeSuccess({ data, md });
  }).pipe(Effect.catchAll(writeFailure)),
);
