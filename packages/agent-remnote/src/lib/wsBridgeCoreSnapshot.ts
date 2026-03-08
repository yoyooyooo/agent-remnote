import type { WsBridgeClient, WsConnId } from '../kernel/ws-bridge/index.js';

import { queueStats } from '../internal/queue/index.js';

import type { WsBridgeCoreConfig, WsBridgeCoreDb, WsBridgeCoreState } from './wsBridgeCoreTypes.js';
import { toNonNegativeInt } from './wsBridgeCoreUtils.js';

function toWsBridgeClient(client: WsBridgeCoreState['clients'] extends Map<any, infer V> ? V : never): WsBridgeClient {
  return {
    connId: client.connId,
    clientType: client.clientType,
    clientInstanceId: client.clientInstanceId,
    protocolVersion: client.protocolVersion,
    capabilities: client.capabilities,
    isActiveWorker: client.isActiveWorker,
    connectedAt: client.connectedAt,
    lastSeenAt: client.lastSeenAt,
    remoteAddr: client.remoteAddr,
    userAgent: client.userAgent,
    readyState: client.readyState,
    selection: client.selection,
    uiContext: client.uiContext,
  };
}

export function buildWsBridgeStateSnapshot(params: {
  readonly now: number;
  readonly state: WsBridgeCoreState;
  readonly config: WsBridgeCoreConfig;
  readonly db: WsBridgeCoreDb;
}): unknown {
  const clients = Array.from(params.state.clients.values()).map(toWsBridgeClient);

  const progressAt = Math.max(params.state.lastAckAt, params.state.lastDispatchAt, params.state.lastWorkSeenAt);
  const noProgressForMs = progressAt > 0 ? Math.max(0, params.now - progressAt) : null;

  const queue = (() => {
    try {
      return { dbPath: params.config.queueDbPath, stats: queueStats(params.db) };
    } catch {
      return { dbPath: params.config.queueDbPath, stats: null };
    }
  })();

  const workerCandidates = clients.filter((c) => c.readyState === 1 && !!c.capabilities?.worker);
  const staleWorkers = workerCandidates.filter(
    (c) => params.now - toNonNegativeInt(c.lastSeenAt) > params.config.activeWorkerStaleMs,
  );
  const quarantinedWorkers = workerCandidates.filter((c) => {
    const quarantineUntil = params.state.workerQuarantineUntilByConnId.get(c.connId);
    return typeof quarantineUntil === 'number' && quarantineUntil > params.now;
  });
  const eligibleWorkers = workerCandidates.filter((c) => {
    if (params.now - toNonNegativeInt(c.lastSeenAt) > params.config.activeWorkerStaleMs) return false;
    const quarantineUntil = params.state.workerQuarantineUntilByConnId.get(c.connId);
    return !(typeof quarantineUntil === 'number' && quarantineUntil > params.now);
  });

  const activeWorkerConnId = params.state.activeWorkerConnId ?? null;

  return {
    updatedAt: params.now,
    server: params.config.serverInfo,
    activeWorkerConnId,
    queue,
    kick: {
      ...params.config.kickConfig,
      lastKickAt: params.state.lastKickAt,
      lastDispatchAt: params.state.lastDispatchAt,
      lastAckAt: params.state.lastAckAt,
      lastWorkSeenAt: params.state.lastWorkSeenAt,
      hasWork: params.state.lastHadWork,
      noProgressForMs,
    },
    election: {
      staleMs: params.config.activeWorkerStaleMs,
      workerCandidates: workerCandidates.length,
      eligibleWorkers: eligibleWorkers.length,
      staleWorkers: staleWorkers.length,
      quarantinedWorkers: quarantinedWorkers.length,
    },
    workerQuarantineUntilByConnId: Array.from(params.state.workerQuarantineUntilByConnId.entries())
      .map(([connId, until]) => ({ connId, until }))
      .sort((a, b) => a.until - b.until),
    clients,
  };
}

export function buildClientsSnapshot(params: { readonly state: WsBridgeCoreState }): {
  readonly clients: readonly WsBridgeClient[];
  readonly activeWorkerConnId: WsConnId | undefined;
} {
  const clients = Array.from(params.state.clients.values()).map(toWsBridgeClient);
  return { clients, activeWorkerConnId: params.state.activeWorkerConnId };
}
