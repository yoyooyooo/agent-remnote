import { Command } from '@effect/cli';
import * as Effect from 'effect/Effect';
import path from 'node:path';

import { AppConfig } from '../../services/AppConfig.js';
import { ApiDaemonFiles } from '../../services/ApiDaemonFiles.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { Process } from '../../services/Process.js';
import { Queue } from '../../services/Queue.js';
import { WsClient } from '../../services/WsClient.js';
import { apiLocalBaseUrl } from '../../lib/apiUrls.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { writeFailure, writeSuccess } from '../_shared.js';

export const stackStatusCommand = Command.make('status', {}, () =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const daemonFiles = yield* DaemonFiles;
    const apiFiles = yield* ApiDaemonFiles;
    const proc = yield* Process;
    const ws = yield* WsClient;
    const queue = yield* Queue;
    const api = yield* HostApiClient;

    const daemonPidFile = resolveUserFilePath(daemonFiles.defaultPidFile());
    const daemonPidInfo = yield* daemonFiles.readPidFile(daemonPidFile);
    const daemonRunning = daemonPidInfo ? yield* proc.isPidRunning(daemonPidInfo.pid) : false;
    const wsHealth = yield* ws.health({ url: cfg.wsUrl, timeoutMs: 2000 }).pipe(Effect.either);
    const clients = yield* ws.queryClients({ url: cfg.wsUrl, timeoutMs: 2000 }).pipe(Effect.either);

    const apiPidFile = resolveUserFilePath(apiFiles.defaultPidFile());
    const apiPidInfo = yield* apiFiles.readPidFile(apiPidFile);
    const apiRunning = apiPidInfo ? yield* proc.isPidRunning(apiPidInfo.pid) : false;
    const apiBasePath = apiPidInfo?.base_path ?? cfg.apiBasePath ?? '/v1';
    const apiBaseUrl = apiLocalBaseUrl(apiPidInfo?.port ?? cfg.apiPort ?? 3000, apiBasePath);
    const apiStatus = yield* api.status({ baseUrl: apiBaseUrl, timeoutMs: 2000 }).pipe(Effect.either);

    const queueStats = yield* queue.stats({ dbPath: cfg.storeDb }).pipe(Effect.either);
    const stateFilePath = resolveUserFilePath(
      daemonPidInfo?.state_file ?? path.join(path.dirname(daemonPidFile), 'ws.state.json'),
    );

    const data = {
      daemon: {
        running: daemonRunning,
        pid: daemonPidInfo?.pid ?? null,
        pid_file: daemonPidFile,
        ws_url: cfg.wsUrl,
        healthy: wsHealth._tag === 'Right',
        state_file: stateFilePath,
      },
      api: {
        running: apiRunning,
        pid: apiPidInfo?.pid ?? null,
        pid_file: apiPidFile,
        base_url: apiBaseUrl,
        base_path: apiBasePath,
        healthy: apiStatus._tag === 'Right',
        status: apiStatus._tag === 'Right' ? apiStatus.right : null,
      },
      active_worker_conn_id: clients._tag === 'Right' ? (clients.right.activeWorkerConnId ?? null) : null,
      queue: queueStats._tag === 'Right' ? queueStats.right : null,
    };

    const md = [
      `- daemon_running: ${data.daemon.running}`,
      `- daemon_pid: ${data.daemon.pid ?? ''}`,
      `- daemon_healthy: ${data.daemon.healthy}`,
      `- api_running: ${data.api.running}`,
      `- api_pid: ${data.api.pid ?? ''}`,
      `- api_healthy: ${data.api.healthy}`,
      `- api_base_url: ${data.api.base_url}`,
      `- api_base_path: ${data.api.base_path}`,
      `- db_read_ready: ${data.api.status?.capabilities?.db_read_ready ?? ''}`,
      `- plugin_rpc_ready: ${data.api.status?.capabilities?.plugin_rpc_ready ?? ''}`,
      `- write_ready: ${data.api.status?.capabilities?.write_ready ?? ''}`,
      `- ui_session_ready: ${data.api.status?.capabilities?.ui_session_ready ?? ''}`,
      `- workspace_resolved: ${data.api.status?.workspace?.resolved ?? ''}`,
      `- current_workspace_id: ${data.api.status?.workspace?.currentWorkspaceId ?? ''}`,
      `- active_worker_conn_id: ${data.active_worker_conn_id ?? ''}`,
      `- queue_pending: ${data.queue?.pending ?? ''}`,
      `- queue_in_flight: ${data.queue?.in_flight ?? ''}`,
    ].join('\n');

    yield* writeSuccess({ data, md });
  }).pipe(Effect.catchAll(writeFailure)),
);
