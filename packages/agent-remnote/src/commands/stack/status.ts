import { Command } from '@effect/cli';
import * as Effect from 'effect/Effect';
import path from 'node:path';

import { AppConfig } from '../../services/AppConfig.js';
import { ApiDaemonFiles } from '../../services/ApiDaemonFiles.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { PluginServerFiles } from '../../services/PluginServerFiles.js';
import { Process } from '../../services/Process.js';
import { Queue } from '../../services/Queue.js';
import { WsClient } from '../../services/WsClient.js';
import { apiLocalBaseUrl } from '../../lib/apiUrls.js';
import { currentExpectedPluginBuildInfo, pluginBuildWarnings } from '../../lib/pluginBuildInfo.js';
import { isTrustedPidRecord } from '../../lib/pidTrust.js';
import { currentRuntimeBuildInfo, runtimeVersionWarnings } from '../../lib/runtimeBuildInfo.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { matchesFixedOwnerClaim, readFixedOwnerClaim } from '../../lib/runtime-ownership/claim.js';
import { resolveRuntimeOwnershipContext } from '../../lib/runtime-ownership/profile.js';
import { getPluginStatus } from '../plugin/status.js';
import { writeFailure, writeSuccess } from '../_shared.js';

export const stackStatusCommand = Command.make('status', {}, () =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const daemonFiles = yield* DaemonFiles;
    const apiFiles = yield* ApiDaemonFiles;
    const pluginFiles = yield* PluginServerFiles;
    const proc = yield* Process;
    const ws = yield* WsClient;
    const queue = yield* Queue;
    const api = yield* HostApiClient;
    const ownership = resolveRuntimeOwnershipContext();
    const fixedOwner = readFixedOwnerClaim(ownership);

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
    const pluginPidFile = resolveUserFilePath(pluginFiles.defaultPidFile());
    const pluginPidInfo = yield* pluginFiles.readPidFile(pluginPidFile);
    const pluginStatus = yield* getPluginStatus({ pidFilePath: pluginPidFile }).pipe(Effect.either);

    const queueStats = yield* queue.stats({ dbPath: cfg.storeDb }).pipe(Effect.either);
    const stateFilePath = resolveUserFilePath(
      daemonPidInfo?.state_file ?? path.join(path.dirname(daemonPidFile), 'ws.state.json'),
    );

    const activeWorkerRuntime =
      clients._tag === 'Right' && typeof clients.right.activeWorkerConnId === 'string'
        ? ((clients.right.clients as any[]).find((client: any) => client.connId === clients.right.activeWorkerConnId)?.runtime ?? null)
        : null;
    const daemonTrusted = daemonPidInfo ? yield* isTrustedPidRecord(daemonPidInfo as any) : false;
    const apiTrusted = apiPidInfo ? yield* isTrustedPidRecord(apiPidInfo as any) : false;
    const pluginTrusted = pluginPidInfo ? yield* isTrustedPidRecord(pluginPidInfo as any) : false;
    const daemonClaimed = daemonTrusted && matchesFixedOwnerClaim({ claim: fixedOwner.claim, owner: daemonPidInfo?.owner });
    const apiClaimed = apiTrusted && matchesFixedOwnerClaim({ claim: fixedOwner.claim, owner: apiPidInfo?.owner });
    const pluginClaimed =
      pluginTrusted && matchesFixedOwnerClaim({ claim: fixedOwner.claim, owner: pluginStatus._tag === 'Right' ? pluginStatus.right.service.owner : null });
    const ownershipConflicts = [
      daemonTrusted && !daemonClaimed
        ? {
            id: 'canonical_owner_mismatch',
            service: 'daemon',
            repair_strategy: 'manual_takeover_required',
            claimed_channel: fixedOwner.claim.claimed_channel,
            live_owner_channel: daemonPidInfo?.owner?.owner_channel ?? null,
          }
        : null,
      apiTrusted && !apiClaimed
        ? {
            id: 'canonical_owner_mismatch',
            service: 'api',
            repair_strategy: 'manual_takeover_required',
            claimed_channel: fixedOwner.claim.claimed_channel,
            live_owner_channel: apiPidInfo?.owner?.owner_channel ?? null,
          }
        : null,
      pluginTrusted && !pluginClaimed
        ? {
            id: 'canonical_owner_mismatch',
            service: 'plugin',
            repair_strategy: 'manual_takeover_required',
            claimed_channel: fixedOwner.claim.claimed_channel,
            live_owner_channel: pluginStatus._tag === 'Right' ? (pluginStatus.right.service.owner?.owner_channel ?? null) : null,
          }
        : null,
    ].filter(Boolean);
    const data = {
      control_plane_root: ownership.controlPlaneRoot,
      resolved_local: {
        profile: ownership.runtimeProfile,
        install_source: ownership.installSource,
        runtime_root: ownership.runtimeRoot,
        worktree_root: ownership.worktreeRoot ?? null,
      },
      fixed_owner_claim: fixedOwner.claim,
      runtime: currentRuntimeBuildInfo(),
      daemon: {
        running: daemonRunning,
        pid: daemonPidInfo?.pid ?? null,
        build: daemonPidInfo?.build ?? null,
        pid_file: daemonPidFile,
        ws_url: cfg.wsUrl,
        healthy: wsHealth._tag === 'Right',
        state_file: stateFilePath,
      },
      api: {
        running: apiRunning,
        pid: apiPidInfo?.pid ?? null,
        build: apiPidInfo?.build ?? null,
        pid_file: apiPidFile,
        base_url: apiBaseUrl,
        base_path: apiBasePath,
        healthy: apiStatus._tag === 'Right',
        status: apiStatus._tag === 'Right' ? apiStatus.right : null,
      },
      active_worker_conn_id: clients._tag === 'Right' ? (clients.right.activeWorkerConnId ?? null) : null,
      active_worker:
        clients._tag === 'Right' && typeof clients.right.activeWorkerConnId === 'string'
          ? (clients.right.clients as any[]).find((client: any) => client.connId === clients.right.activeWorkerConnId) ?? null
          : null,
      services: {
        daemon: {
          running: daemonRunning,
          pid: daemonPidInfo?.pid ?? null,
          pid_file: daemonPidFile,
          state_file: stateFilePath,
          healthy: wsHealth._tag === 'Right',
          owner: daemonPidInfo?.owner ?? null,
          trusted: daemonTrusted,
          claimed: daemonClaimed,
        },
        api: {
          running: apiRunning,
          pid: apiPidInfo?.pid ?? null,
          pid_file: apiPidFile,
          healthy: apiStatus._tag === 'Right',
          base_url: apiBaseUrl,
          owner: apiPidInfo?.owner ?? null,
          trusted: apiTrusted,
          claimed: apiClaimed,
        },
        plugin:
          pluginStatus._tag === 'Right'
            ? {
                running: pluginStatus.right.service.running,
                pid: pluginStatus.right.service.pid,
                pid_file: pluginStatus.right.service.pid_file,
                healthy: pluginStatus.right.plugin_server.healthy,
                base_url: pluginStatus.right.plugin_server.base_url,
                owner: pluginStatus.right.service.owner,
                trusted: pluginTrusted,
                claimed: pluginClaimed,
              }
            : {
                running: false,
                pid: null,
                pid_file: pluginPidFile,
                healthy: false,
                base_url: null,
                owner: null,
                trusted: false,
                claimed: false,
              },
      },
      ownership_conflicts: ownershipConflicts,
      queue: queueStats._tag === 'Right' ? queueStats.right : null,
      warnings: [
        ...runtimeVersionWarnings({
          current: currentRuntimeBuildInfo(),
          daemon: daemonPidInfo?.build ?? null,
          api: apiPidInfo?.build ?? null,
        }),
        ...pluginBuildWarnings({
          expected: currentExpectedPluginBuildInfo(),
          live: activeWorkerRuntime,
        }),
      ],
    };

    const md = [
      `- resolved_local_profile: ${data.resolved_local.profile}`,
      `- fixed_owner_claimed_channel: ${data.fixed_owner_claim.claimed_channel}`,
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
