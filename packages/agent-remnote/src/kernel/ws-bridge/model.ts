export type WsConnId = string;

export type WsClientCapabilities = {
  readonly control?: boolean | undefined;
  readonly worker?: boolean | undefined;
  readonly readRpc?: boolean | undefined;
  readonly batchPull?: boolean | undefined;
};

export type WsClientSelection =
  | { readonly kind: 'none'; readonly selectionType?: string | undefined; readonly updatedAt: number }
  | {
      readonly kind: 'rem';
      readonly selectionType?: string | undefined;
      readonly totalCount: number;
      readonly truncated: boolean;
      readonly remIds: readonly string[];
      readonly updatedAt: number;
    }
  | {
      readonly kind: 'text';
      readonly selectionType?: string | undefined;
      readonly remId: string;
      readonly range: { readonly start: number; readonly end: number };
      readonly isReverse: boolean;
      readonly updatedAt: number;
    };

export type WsClientUiContext = {
  readonly url: string;
  readonly paneId: string;
  readonly pageRemId: string;
  readonly focusedRemId: string;
  readonly focusedPortalId: string;
  readonly kbId?: string | undefined;
  readonly kbName?: string | undefined;
  readonly source?: string | undefined;
  readonly updatedAt: number;
};

export type WsBridgeClient = {
  readonly connId: WsConnId;
  readonly clientType?: string | undefined;
  readonly clientInstanceId?: string | null | undefined;
  readonly protocolVersion?: number | undefined;
  readonly capabilities?: WsClientCapabilities | undefined;
  readonly isActiveWorker?: boolean | undefined;
  readonly connectedAt: number;
  readonly lastSeenAt: number;
  readonly remoteAddr?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly readyState: number;
  readonly selection?: WsClientSelection | undefined;
  readonly uiContext?: WsClientUiContext | undefined;
};

export type WsBridgeServerInfo = {
  readonly port: number;
  readonly path: string;
};

export type WsBridgeKickConfig = {
  readonly enabled: boolean;
  readonly intervalMs: number;
  readonly cooldownMs: number;
  readonly noProgressWarnMs: number;
  readonly noProgressEscalateMs: number;
};

export type WsBridgeKickSnapshot = WsBridgeKickConfig & {
  readonly lastKickAt: number;
  readonly lastDispatchAt: number;
  readonly lastAckAt: number;
  readonly lastWorkSeenAt: number;
  readonly hasWork: boolean;
  readonly noProgressForMs: number | null;
};

export type WsBridgeStateFileSnapshot = {
  readonly updatedAt: number;
  readonly server?: WsBridgeServerInfo | undefined;
  readonly activeWorkerConnId?: WsConnId | undefined;
  readonly kick: WsBridgeKickSnapshot;
  readonly clients: readonly WsBridgeClient[];
};
