import type { WsBridgeClient, WsConnId } from '../kernel/ws-bridge/index.js';
import { activityAt, electActiveWorker, normalizeSelectionForUiContext } from '../kernel/ws-bridge/index.js';

import { queueStats, recoverExpiredLeases } from '../internal/queue/index.js';

import { handleOpAckMessage } from './wsBridgeCoreAck.js';
import { selectOpsForDispatch } from './wsBridgeCoreDispatch.js';
import { handleLeaseExtendMessage } from './wsBridgeCoreLease.js';
import { abortPendingSearchForConnId, handleSearchRequestMessage, handleSearchResponseMessage, handleSearchTimeout } from './wsBridgeCoreReadRpc.js';
import { buildClientsSnapshot, buildWsBridgeStateSnapshot } from './wsBridgeCoreSnapshot.js';
import type {
  WsBridgeCore,
  WsBridgeCoreAction,
  WsBridgeCoreClientState,
  WsBridgeCoreConfig,
  WsBridgeCoreDb,
  WsBridgeCoreEvent,
  WsBridgeCoreState,
} from './wsBridgeCoreTypes.js';

const STATE_WRITE_TIMER_ID = 'state-write';

function newClientState(params: {
  readonly connId: WsConnId;
  readonly now: number;
  readonly remoteAddr?: string | undefined;
  readonly userAgent?: string | undefined;
}): WsBridgeCoreClientState {
  return {
    connId: params.connId,
    connectedAt: params.now,
    lastSeenAt: params.now,
    remoteAddr: params.remoteAddr,
    userAgent: params.userAgent,
    readyState: 1,
  };
}

function startSyncResultNoActive(): {
  readonly sent: number;
  readonly activeConnId?: string | undefined;
  readonly reason?: string | undefined;
  readonly nextActions?: readonly string[] | undefined;
} {
  return {
    sent: 0,
    reason: 'no_active_worker',
    nextActions: [
      'Switch to the target RemNote window to trigger a selection change',
      'Check that the plugin control channel is connected',
    ],
  };
}

export function makeWsBridgeCore(params: {
  readonly config: WsBridgeCoreConfig;
  readonly db: WsBridgeCoreDb;
}): WsBridgeCore {
  const config: WsBridgeCoreConfig = params.config;
  const db = params.db;

  const state: WsBridgeCoreState = {
    clients: new Map(),
    activeWorkerConnId: undefined,
    workerQuarantineUntilByConnId: new Map(),
    pendingSearchByForwardedRequestId: new Map(),

    lastKickAt: 0,
    lastDispatchAt: 0,
    lastAckAt: 0,
    lastWorkSeenAt: 0,
    lastHadWork: false,
    lastNoProgressWarnAt: 0,
    lastNoProgressEscalateAt: 0,
    lastNoActiveWorkerWarnAt: 0,

    lastStateWriteAt: 0,
    stateWriteScheduled: false,
    stateWritePending: false,
  };

  const scheduleStateWrite = (now: number): WsBridgeCoreAction[] => {
    if (!config.stateFileEnabled) return [];

    state.stateWritePending = true;
    if (state.stateWriteScheduled) return [];
    state.stateWriteScheduled = true;

    const elapsed = now - state.lastStateWriteAt;
    const delay = elapsed >= config.stateWriteMinIntervalMs ? 0 : config.stateWriteMinIntervalMs - elapsed;
    return [{ _tag: 'SetTimer', id: STATE_WRITE_TIMER_ID, delayMs: delay, event: { _tag: 'StateWriteDue' } }];
  };

  const recomputeActiveWorker = (now: number): WsBridgeCoreAction[] => {
    const clients = Array.from(state.clients.values()).map(toWsBridgeClient);
    const prev = state.activeWorkerConnId;
    const next = electActiveWorker({
      now,
      staleMs: config.activeWorkerStaleMs,
      quarantineUntilByConnId: state.workerQuarantineUntilByConnId,
      clients,
    });

    if (next === prev) return [];
    state.activeWorkerConnId = next;

    for (const client of state.clients.values()) {
      client.isActiveWorker = !!next && client.connId === next;
    }

    return [
      {
        _tag: 'Log',
        level: 'debug',
        event: 'active_worker_changed',
        details: {
          prev: prev ?? null,
          next: next ?? null,
          workerCandidates: clients
            .filter((c) => c.readyState === 1 && !!c.capabilities?.worker)
            .map((c) => ({
              connId: c.connId,
              clientType: c.clientType ?? null,
              protocolVersion: c.protocolVersion ?? null,
              activityAt: activityAt(c),
              lastSeenAt: c.lastSeenAt,
              quarantineUntil: state.workerQuarantineUntilByConnId.get(c.connId) ?? null,
            })),
        },
      },
    ];
  };

  const handle: WsBridgeCore['handle'] = (event: WsBridgeCoreEvent) => {
    const actions: WsBridgeCoreAction[] = [];

    if (event._tag === 'ServerInfoUpdated') {
      (config as any).serverInfo = event.serverInfo;
      actions.push(...scheduleStateWrite(event.now));
      actions.push({ _tag: 'InvalidateStatusLine', reason: 'server_info_updated' });
      return actions;
    }

    if (event._tag === 'Connected') {
      state.clients.set(event.connId, newClientState(event));
      actions.push(...recomputeActiveWorker(event.now));
      actions.push(...scheduleStateWrite(event.now));
      actions.push({ _tag: 'InvalidateStatusLine', reason: 'client_connected' });
      actions.push({
        _tag: 'Log',
        level: 'debug',
        event: 'client_connected',
        details: { connId: event.connId, remoteAddr: event.remoteAddr ?? null, userAgent: event.userAgent ?? null },
      });
      return actions;
    }

    if (event._tag === 'Disconnected') {
      state.clients.delete(event.connId);
      actions.push(...abortPendingSearchForConnId({ now: event.now, state, config, connId: event.connId }));
      actions.push(...recomputeActiveWorker(event.now));
      actions.push(...scheduleStateWrite(event.now));
      actions.push({ _tag: 'InvalidateStatusLine', reason: 'client_disconnected' });
      actions.push({ _tag: 'Log', level: 'debug', event: 'client_disconnected', details: { connId: event.connId } });
      return actions;
    }

    if (event._tag === 'Pong') {
      const client = state.clients.get(event.connId);
      if (client) client.lastSeenAt = event.now;
      return actions;
    }

    if (event._tag === 'HeartbeatTick') {
      actions.push({ _tag: 'HeartbeatSweep' });
      try {
        void recoverExpiredLeases(db);
      } catch {}
      actions.push(...recomputeActiveWorker(event.now));
      actions.push(...scheduleStateWrite(event.now));
      return actions;
    }

    if (event._tag === 'KickTick') {
      actions.push(...recomputeActiveWorker(event.now));

      const st = (() => {
        try {
          return queueStats(db);
        } catch {
          return null;
        }
      })();
      const hasPending = typeof (st as any)?.pending === 'number' && (st as any).pending > 0;
      const hasInFlight = typeof (st as any)?.in_flight === 'number' && (st as any).in_flight > 0;
      const hasWork = hasPending || hasInFlight;
      if (!hasWork) {
        state.lastHadWork = false;
        state.lastWorkSeenAt = 0;
        return actions;
      }
      if (!state.lastHadWork) {
        state.lastHadWork = true;
        state.lastWorkSeenAt = event.now;
      }

      const activeConnId = state.activeWorkerConnId;
      if (!activeConnId) {
        if (
          hasPending &&
          event.now - state.lastWorkSeenAt >= config.kickConfig.noProgressWarnMs &&
          event.now - state.lastNoActiveWorkerWarnAt >= config.noActiveWorkerWarnCooldownMs
        ) {
          state.lastNoActiveWorkerWarnAt = event.now;
          actions.push({
            _tag: 'Log',
            level: 'warn',
            event: 'no_active_worker_with_pending',
            details: {
              pending: (st as any)?.pending ?? null,
              in_flight: (st as any)?.in_flight ?? null,
              clients: state.clients.size,
              workerCandidates: Array.from(state.clients.values()).filter((c) => !!c.capabilities?.worker).length,
              hint: 'Switch to the RemNote window to trigger a selection/uiContext update',
            },
          });
        }
        return actions;
      }

      const progressAt = Math.max(state.lastAckAt, state.lastDispatchAt, state.lastWorkSeenAt);
      const noProgressForMs = progressAt > 0 ? event.now - progressAt : Number.POSITIVE_INFINITY;

      if (
        config.kickConfig.noProgressEscalateMs > 0 &&
        noProgressForMs >= config.kickConfig.noProgressEscalateMs &&
        event.now - state.lastNoProgressEscalateAt >= config.kickConfig.cooldownMs
      ) {
        state.lastNoProgressEscalateAt = event.now;
        const quarantineMs = Math.max(config.activeWorkerStaleMs, 60_000);
        state.workerQuarantineUntilByConnId.set(activeConnId, event.now + quarantineMs);
        actions.push({
          _tag: 'Log',
          level: 'warn',
          event: 'quarantine_active_worker_due_to_no_progress',
          details: { activeConnId, quarantineMs, noProgressForMs },
        });
        actions.push(...recomputeActiveWorker(event.now));
      } else if (
        config.kickConfig.noProgressWarnMs > 0 &&
        noProgressForMs >= config.kickConfig.noProgressWarnMs &&
        event.now - state.lastNoProgressWarnAt >= config.kickConfig.cooldownMs
      ) {
        state.lastNoProgressWarnAt = event.now;
        actions.push({ _tag: 'Log', level: 'warn', event: 'no_progress_warn', details: { activeConnId, noProgressForMs } });
        actions.push(...recomputeActiveWorker(event.now));
      }

      if (event.now - state.lastKickAt < config.kickConfig.cooldownMs) return actions;
      if (noProgressForMs < config.kickConfig.cooldownMs) return actions;
      if (!hasPending) return actions;

      actions.push({
        _tag: 'SendJsonWithResult',
        connId: activeConnId,
        msg: { type: 'StartSync' },
        onResult: (ok) => {
          if (!ok) return [];
          state.lastKickAt = event.now;
          return [...scheduleStateWrite(event.now), { _tag: 'InvalidateStatusLine', reason: 'kick_start_sync' }];
        },
      });

      return actions;
    }

    if (event._tag === 'Timer') {
      if (event.event._tag === 'StateWriteDue') {
        if (state.stateWritePending) {
          state.lastStateWriteAt = event.now;
          state.stateWriteScheduled = false;
          state.stateWritePending = false;

          actions.push({
            _tag: 'WriteState',
            snapshot: buildWsBridgeStateSnapshot({ now: event.now, state, config, db }),
          });
          actions.push({ _tag: 'InvalidateStatusLine', reason: 'ws_state_written' });
        } else {
          state.stateWriteScheduled = false;
        }
        return actions;
      }

      if (event.event._tag === 'SearchTimeout') {
        actions.push(...handleSearchTimeout({ now: event.now, state, config, forwardedRequestId: event.event.forwardedRequestId }));
        return actions;
      }

      return actions;
    }

    // event._tag === 'MessageJson'
    const msg: any = event.msg;
    const type = typeof msg?.type === 'string' ? msg.type : '';
    if (!type) return actions;

    const client = state.clients.get(event.connId);
    if (client) client.lastSeenAt = event.now;

    const send = (connId: WsConnId, payload: unknown) => actions.push({ _tag: 'SendJson', connId, msg: payload });

    switch (type) {
      case 'Hello': {
        send(event.connId, { type: 'HelloAck', ok: true, connId: event.connId });
        return actions;
      }

      case 'Register': {
        if (!client) {
          send(event.connId, { type: 'Error', message: 'unknown client' });
          return actions;
        }

        const clientType = typeof msg?.clientType === 'string' ? msg.clientType.trim() : '';
        const clientInstanceIdRaw = typeof msg?.clientInstanceId === 'string' ? msg.clientInstanceId.trim() : '';
        const protocolVersionRaw =
          typeof msg?.protocolVersion === 'number'
            ? msg.protocolVersion
            : typeof msg?.protocol_version === 'number'
              ? msg.protocol_version
              : undefined;
        const protocolVersion =
          typeof protocolVersionRaw === 'number' && Number.isFinite(protocolVersionRaw) && protocolVersionRaw > 0
            ? Math.floor(protocolVersionRaw)
            : undefined;
        const capabilities = msg?.capabilities && typeof msg.capabilities === 'object' ? msg.capabilities : {};

        client.clientType = clientType || client.clientType;
        client.clientInstanceId = clientInstanceIdRaw ? clientInstanceIdRaw : null;
        if (protocolVersion) client.protocolVersion = protocolVersion;
        client.capabilities = {
          control: !!(capabilities as any)?.control,
          worker: !!(capabilities as any)?.worker,
          readRpc: !!(capabilities as any)?.readRpc,
          batchPull: !!(capabilities as any)?.batchPull,
        };

        actions.push(...recomputeActiveWorker(event.now));
        actions.push(...scheduleStateWrite(event.now));
        actions.push({ _tag: 'InvalidateStatusLine', reason: 'registered' });
        actions.push({
          _tag: 'Log',
          level: 'debug',
          event: 'client_registered',
          details: {
            connId: event.connId,
            clientType: client.clientType ?? null,
            protocolVersion: client.protocolVersion ?? null,
            capabilities: client.capabilities ?? null,
          },
        });
        send(event.connId, { type: 'Registered', connId: event.connId });
        return actions;
      }

      case 'SelectionChanged': {
        if (!client) {
          send(event.connId, { type: 'Error', message: 'unknown client' });
          return actions;
        }

        const selectionType = typeof msg?.selectionType === 'string' ? msg.selectionType : undefined;
        const kindRaw = typeof msg?.kind === 'string' ? msg.kind.trim() : '';

        const rawIds = Array.isArray(msg?.remIds) ? msg.remIds : [];
        const remIds = rawIds.filter((x: any) => typeof x === 'string' && x.trim()).slice(0, 200) as string[];
        const totalCountRaw = typeof msg?.totalCount === 'number' ? msg.totalCount : remIds.length;
        const totalCount =
          Number.isFinite(totalCountRaw) && totalCountRaw >= 0 ? Math.floor(totalCountRaw) : remIds.length;
        const truncated = !!msg?.truncated || totalCount > remIds.length;

        const textRemId = typeof msg?.remId === 'string' ? msg.remId.trim() : '';
        const startRaw = (msg as any)?.range?.start;
        const endRaw = (msg as any)?.range?.end;
        const start = typeof startRaw === 'number' && Number.isFinite(startRaw) ? Math.floor(startRaw) : NaN;
        const end = typeof endRaw === 'number' && Number.isFinite(endRaw) ? Math.floor(endRaw) : NaN;
        const isReverse = (msg as any)?.isReverse === true;

        const isTextKind =
          kindRaw === 'text' ||
          (kindRaw === '' && selectionType === 'Text' && !!textRemId && Number.isFinite(start) && Number.isFinite(end));
        const isRemKind =
          kindRaw === 'rem' || (kindRaw === '' && (selectionType === 'Rem' || remIds.length > 0 || totalCount > 0));

        let ackCount = 0;
        if (isTextKind && textRemId && Number.isFinite(start) && Number.isFinite(end) && start !== end) {
          client.selection = {
            kind: 'text',
            selectionType,
            remId: textRemId,
            range: { start, end },
            isReverse,
            updatedAt: event.now,
          };
          ackCount = 1;
        } else if (isRemKind && (remIds.length > 0 || totalCount > 0)) {
          client.selection = {
            kind: 'rem',
            selectionType,
            totalCount,
            truncated,
            remIds,
            updatedAt: event.now,
          };
          ackCount = totalCount;
        } else {
          client.selection = { kind: 'none', selectionType: undefined, updatedAt: event.now };
          ackCount = 0;
        }

        client.selection = normalizeSelectionForUiContext({ selection: client.selection, uiContext: client.uiContext, now: event.now });

        actions.push(...recomputeActiveWorker(event.now));
        actions.push(...scheduleStateWrite(event.now));
        actions.push({ _tag: 'InvalidateStatusLine', reason: 'selection_changed' });
        send(event.connId, { type: 'SelectionAck', totalCount: ackCount });
        return actions;
      }

      case 'UiContextChanged': {
        if (!client) {
          send(event.connId, { type: 'Error', message: 'unknown client' });
          return actions;
        }

        const url = typeof msg?.url === 'string' ? msg.url : '';
        const paneId = typeof msg?.paneId === 'string' ? msg.paneId : '';
        const pageRemId = typeof msg?.pageRemId === 'string' ? msg.pageRemId : '';
        const focusedRemId = typeof msg?.focusedRemId === 'string' ? msg.focusedRemId : '';
        const focusedPortalId = typeof msg?.focusedPortalId === 'string' ? msg.focusedPortalId : '';
        const kbId = typeof msg?.kbId === 'string' ? msg.kbId : undefined;
        const kbName = typeof msg?.kbName === 'string' ? msg.kbName : undefined;
        const source = typeof msg?.source === 'string' ? msg.source : undefined;

        client.uiContext = {
          url,
          paneId,
          pageRemId,
          focusedRemId,
          focusedPortalId,
          kbId,
          kbName,
          source,
          updatedAt: event.now,
        };

        client.selection = normalizeSelectionForUiContext({ selection: client.selection, uiContext: client.uiContext, now: event.now });

        actions.push(...recomputeActiveWorker(event.now));
        actions.push(...scheduleStateWrite(event.now));
        actions.push({ _tag: 'InvalidateStatusLine', reason: 'ui_context_changed' });
        send(event.connId, { type: 'UiContextAck', pageRemId, focusedRemId });
        return actions;
      }

      case 'RequestOp': {
        send(event.connId, {
          type: 'Error',
          code: 'WS_PROTOCOL_LEGACY_REQUEST_OP',
          message: 'Legacy RequestOp is not supported',
          nextActions: ['Update the RemNote plugin to WS Protocol v2', 'Restart the plugin and retry'],
        });
        return actions;
      }

      case 'RequestOps': {
        if (!client) {
          send(event.connId, { type: 'Error', message: 'unknown client' });
          return actions;
        }
        if (!client.capabilities?.worker) {
          send(event.connId, { type: 'Error', message: 'worker capability required' });
          return actions;
        }
        if (client.protocolVersion !== 2 || !client.capabilities?.batchPull) {
          send(event.connId, {
            type: 'Error',
            code: 'WS_PROTOCOL_VERSION_MISMATCH',
            message: 'WS Protocol v2 is required',
            details: { expected: 2, got: client.protocolVersion ?? null, batchPull: !!client.capabilities?.batchPull },
            nextActions: ['Update the RemNote plugin', 'Restart the plugin and retry'],
          });
          return actions;
        }

        if (!state.activeWorkerConnId || client.connId !== state.activeWorkerConnId) {
          actions.push({
            _tag: 'Log',
            level: 'debug',
            event: 'no_work_not_active_worker',
            details: { connId: client.connId, activeConnId: state.activeWorkerConnId ?? null },
          });
          send(event.connId, { type: 'NoWork', reason: 'not_active_worker', activeConnId: state.activeWorkerConnId });
          return actions;
        }

        const leaseMsRaw = typeof msg?.leaseMs === 'number' ? msg.leaseMs : undefined;
        const leaseMsRequested = Number.isFinite(leaseMsRaw) && leaseMsRaw > 0 ? Math.floor(leaseMsRaw) : undefined;

        const maxOpsRaw = typeof msg?.maxOps === 'number' ? msg.maxOps : typeof msg?.max_ops === 'number' ? msg.max_ops : 1;
        const maxOpsRequested = Number.isFinite(maxOpsRaw) && maxOpsRaw > 0 ? Math.floor(maxOpsRaw) : 1;

        const maxBytesRaw = typeof msg?.maxBytes === 'number' ? msg.maxBytes : typeof msg?.max_bytes === 'number' ? msg.max_bytes : undefined;
        const maxBytesRequested = Number.isFinite(maxBytesRaw) && maxBytesRaw > 0 ? Math.floor(maxBytesRaw) : undefined;

        const maxOpBytesRaw =
          typeof msg?.maxOpBytes === 'number' ? msg.maxOpBytes : typeof msg?.max_op_bytes === 'number' ? msg.max_op_bytes : undefined;
        const maxOpBytesRequested = Number.isFinite(maxOpBytesRaw) && maxOpBytesRaw > 0 ? Math.floor(maxOpBytesRaw) : undefined;

        const selected = selectOpsForDispatch({
          db,
          cfg: config,
          client,
          leaseMsRequested,
          maxOpsRequested,
          maxBytesRequested,
          maxOpBytesRequested,
        });

        if (selected.kind === 'oversize') {
          actions.push({
            _tag: 'Log',
            level: 'warn',
            event: 'oversize_op_dead',
            details: {
              connId: client.connId,
              opId: selected.opId,
              opBytes: selected.opBytes,
              maxOpBytesEffective: selected.maxOpBytesEffective,
              maxBytesEffective: selected.maxBytesEffective,
            },
          });
          send(event.connId, {
            type: 'Error',
            code: 'OP_PAYLOAD_TOO_LARGE',
            message: 'Operation payload is too large for dispatch',
            details: {
              opId: selected.opId,
              opBytes: selected.opBytes,
              maxOpBytesEffective: selected.maxOpBytesEffective,
              maxBytesEffective: selected.maxBytesEffective,
            },
            nextActions: [
              `agent-remnote queue inspect --op ${selected.opId}`,
              'Split the write into smaller chunks and re-enqueue',
              'Increase REMNOTE_WS_DISPATCH_MAX_OP_BYTES / REMNOTE_WS_DISPATCH_MAX_BYTES if you own the daemon',
            ],
          });
          return actions;
        }

        if (selected.kind !== 'dispatch') {
          actions.push({ _tag: 'Log', level: 'debug', event: 'no_work_empty', details: { connId: client.connId } });
          send(event.connId, { type: 'NoWork', reason: 'empty' });
          return actions;
        }

        state.lastDispatchAt = event.now;
        actions.push(...scheduleStateWrite(event.now));
        actions.push({ _tag: 'InvalidateStatusLine', reason: 'op_dispatched' });
        actions.push({
          _tag: 'Log',
          level: 'debug',
          event: 'op_dispatched',
          details: {
            connId: client.connId,
            count: Array.isArray(selected.msg?.ops) ? selected.msg.ops.length : 0,
            firstOpId: selected.firstOpId,
            budget: selected.msg?.budget ?? null,
            skipped: selected.msg?.skipped ?? null,
          },
        });
        send(event.connId, selected.msg);
        return actions;
      }

      case 'TriggerStartSync': {
        const activeConnId = state.activeWorkerConnId;
        if (!activeConnId) {
          send(event.connId, { type: 'StartSyncTriggered', ...startSyncResultNoActive() });
          actions.push(...scheduleStateWrite(event.now));
          actions.push({ _tag: 'InvalidateStatusLine', reason: 'trigger_start_sync' });
          return actions;
        }

        actions.push({
          _tag: 'SendJsonWithResult',
          connId: activeConnId,
          msg: { type: 'StartSync' },
          onResult: (ok) => {
            if (ok) {
              return [
                { _tag: 'SendJson', connId: event.connId, msg: { type: 'StartSyncTriggered', sent: 1, activeConnId } },
                ...scheduleStateWrite(event.now),
                { _tag: 'InvalidateStatusLine', reason: 'trigger_start_sync' },
              ];
            }
            return [
              {
                _tag: 'SendJson',
                connId: event.connId,
                msg: {
                  type: 'StartSyncTriggered',
                  sent: 0,
                  activeConnId,
                  reason: 'no_active_worker',
                  nextActions: ['Reconnect the RemNote plugin control channel', 'Check daemon logs for connection churn'],
                },
              },
              ...scheduleStateWrite(event.now),
              { _tag: 'InvalidateStatusLine', reason: 'trigger_start_sync' },
            ];
          },
        });

        return actions;
      }

      case 'SearchRequest': {
        if (!client) {
          send(event.connId, { type: 'Error', message: 'unknown client' });
          return actions;
        }

        actions.push(...handleSearchRequestMessage({ now: event.now, state, config, client, msg }));
        return actions;
      }

      case 'SearchResponse': {
        actions.push(...handleSearchResponseMessage({ now: event.now, state, clientConnId: event.connId, msg }));
        return actions;
      }

      case 'LeaseExtend': {
        actions.push(...handleLeaseExtendMessage({ db, client, connId: event.connId, msg }));
        return actions;
      }

      case 'OpAck': {
        const res = handleOpAckMessage({ now: event.now, db, connId: event.connId, msg });
        actions.push(...res.actions);
        if (res.touchAckTimestamp) {
          state.lastAckAt = event.now;
          actions.push(...scheduleStateWrite(event.now));
        }
        if (res.invalidateStatusLineReason) {
          actions.push({ _tag: 'InvalidateStatusLine', reason: res.invalidateStatusLineReason });
        }
        return actions;
      }

      case 'QueryStats': {
        const st = (() => {
          try {
            return queueStats(db);
          } catch {
            return null;
          }
        })();
        send(event.connId, { type: 'Stats', ...(st ?? {}) });
        return actions;
      }

      case 'QueryClients': {
        const snap = buildClientsSnapshot({ state });
        send(event.connId, { type: 'Clients', clients: snap.clients, activeWorkerConnId: snap.activeWorkerConnId });
        return actions;
      }

      case 'WhoAmI': {
        send(event.connId, { type: 'YouAre', connId: event.connId, clientType: client?.clientType, lastSeenAt: client?.lastSeenAt });
        return actions;
      }

      default: {
        send(event.connId, { type: 'Error', message: 'unknown message type' });
        return actions;
      }
    }
  };

  return {
    config,
    state,
    handle,
    getClientsSnapshot: () => buildClientsSnapshot({ state }),
  };
}

function toWsBridgeClient(client: WsBridgeCoreClientState): WsBridgeClient {
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
