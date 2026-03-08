import type { openQueueDb } from '../internal/queue/index.js';
import type {
  WsBridgeClient,
  WsBridgeKickConfig,
  WsBridgeServerInfo,
  WsClientCapabilities,
  WsClientSelection,
  WsClientUiContext,
  WsConnId,
} from '../kernel/ws-bridge/index.js';

export type WsBridgeCoreConfig = {
  readonly serverInfo: WsBridgeServerInfo;
  readonly queueDbPath: string;

  readonly stateFileEnabled: boolean;
  readonly stateWriteMinIntervalMs: number;

  readonly activeWorkerStaleMs: number;
  readonly noActiveWorkerWarnCooldownMs: number;

  readonly kickConfig: WsBridgeKickConfig;

  readonly wsSchedulerEnabled: boolean;
  readonly wsDispatchMaxBytes: number;
  readonly wsDispatchMaxOpBytes: number;

  readonly buildDbFallbackNextAction: (queryText: string) => string;
};

export type WsBridgeCoreClientState = {
  connId: WsConnId;
  clientType?: string;
  clientInstanceId?: string | null;
  protocolVersion?: number;
  capabilities?: WsClientCapabilities | undefined;
  isActiveWorker?: boolean;
  connectedAt: number;
  lastSeenAt: number;
  remoteAddr?: string;
  userAgent?: string;
  readyState: number;
  selection?: WsClientSelection;
  uiContext?: WsClientUiContext;
};

export type WsBridgeCorePendingSearch = {
  readonly callerConnId: WsConnId;
  readonly workerConnId: WsConnId;
  readonly originalRequestId: string;
  readonly forwardedRequestId: string;
  readonly queryText: string;
  readonly startedAt: number;
  readonly timeoutMs: number;
  readonly limitRequested: number;
  readonly limitEffective: number;
  readonly limitClamped: boolean;
  readonly maxPreviewChars: number;
  readonly timeoutTimerId: string;
};

export type WsBridgeCoreState = {
  readonly clients: Map<WsConnId, WsBridgeCoreClientState>;
  activeWorkerConnId?: WsConnId;
  readonly workerQuarantineUntilByConnId: Map<WsConnId, number>;
  readonly pendingSearchByForwardedRequestId: Map<string, WsBridgeCorePendingSearch>;

  lastKickAt: number;
  lastDispatchAt: number;
  lastAckAt: number;
  lastWorkSeenAt: number;
  lastHadWork: boolean;
  lastNoProgressWarnAt: number;
  lastNoProgressEscalateAt: number;
  lastNoActiveWorkerWarnAt: number;

  lastStateWriteAt: number;
  stateWriteScheduled: boolean;
  stateWritePending: boolean;
};

export type WsBridgeCoreTimerEvent =
  | { readonly _tag: 'StateWriteDue' }
  | { readonly _tag: 'SearchTimeout'; readonly forwardedRequestId: string };

export type WsBridgeCoreEvent =
  | {
      readonly _tag: 'Connected';
      readonly now: number;
      readonly connId: WsConnId;
      readonly remoteAddr?: string | undefined;
      readonly userAgent?: string | undefined;
    }
  | { readonly _tag: 'Disconnected'; readonly now: number; readonly connId: WsConnId }
  | { readonly _tag: 'Pong'; readonly now: number; readonly connId: WsConnId }
  | { readonly _tag: 'MessageJson'; readonly now: number; readonly connId: WsConnId; readonly msg: unknown }
  | { readonly _tag: 'HeartbeatTick'; readonly now: number }
  | { readonly _tag: 'KickTick'; readonly now: number }
  | { readonly _tag: 'Timer'; readonly now: number; readonly event: WsBridgeCoreTimerEvent }
  | { readonly _tag: 'ServerInfoUpdated'; readonly now: number; readonly serverInfo: WsBridgeServerInfo };

export type WsBridgeCoreLogLevel = 'debug' | 'warn' | 'error';

export type WsBridgeCoreAction =
  | { readonly _tag: 'SendJson'; readonly connId: WsConnId; readonly msg: unknown }
  | {
      readonly _tag: 'SendJsonWithResult';
      readonly connId: WsConnId;
      readonly msg: unknown;
      readonly onResult: (ok: boolean) => readonly WsBridgeCoreAction[];
    }
  | { readonly _tag: 'Terminate'; readonly connId: WsConnId }
  | { readonly _tag: 'HeartbeatSweep' }
  | { readonly _tag: 'SetTimer'; readonly id: string; readonly delayMs: number; readonly event: WsBridgeCoreTimerEvent }
  | { readonly _tag: 'ClearTimer'; readonly id: string }
  | { readonly _tag: 'WriteState'; readonly snapshot: unknown }
  | { readonly _tag: 'InvalidateStatusLine'; readonly reason: string }
  | { readonly _tag: 'Log'; readonly level: WsBridgeCoreLogLevel; readonly event: string; readonly details?: unknown };

export type WsBridgeCoreDb = ReturnType<typeof openQueueDb>;

export type WsBridgeCore = {
  readonly config: WsBridgeCoreConfig;
  readonly state: WsBridgeCoreState;
  readonly handle: (event: WsBridgeCoreEvent) => readonly WsBridgeCoreAction[];
  readonly getClientsSnapshot: () => {
    readonly clients: readonly WsBridgeClient[];
    readonly activeWorkerConnId: WsConnId | undefined;
  };
};
