import type { WsBridgeClient, WsConnId } from './model.js';

export type WsBridgeElectionParams = {
  readonly now: number;
  readonly staleMs: number;
  readonly quarantineUntilByConnId: ReadonlyMap<WsConnId, number>;
  readonly clients: Iterable<WsBridgeClient>;
};

function toNonNegativeInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

export function activityAt(client: WsBridgeClient): number {
  const selAt = toNonNegativeInt(client.selection?.updatedAt ?? 0);
  const ctxAt = toNonNegativeInt(client.uiContext?.updatedAt ?? 0);
  // IMPORTANT: Do NOT include lastSeenAt in ordering; heartbeats would cause election flapping.
  return Math.max(selAt, ctxAt);
}

export function electActiveWorker(params: WsBridgeElectionParams): WsConnId | undefined {
  type Candidate = { readonly connId: WsConnId; readonly connectedAt: number; readonly activityAt: number };
  let best: Candidate | undefined;

  for (const client of params.clients) {
    if (client.readyState !== 1) continue; // WebSocket.OPEN
    if (!client.capabilities?.worker) continue;
    if (params.now - toNonNegativeInt(client.lastSeenAt) > params.staleMs) continue;

    const quarantineUntil = params.quarantineUntilByConnId.get(client.connId);
    if (typeof quarantineUntil === 'number' && quarantineUntil > params.now) continue;

    const a = activityAt(client);
    const cand: Candidate = { connId: client.connId, connectedAt: toNonNegativeInt(client.connectedAt), activityAt: a };

    if (!best) {
      best = cand;
      continue;
    }

    if (cand.activityAt > best.activityAt) {
      best = cand;
      continue;
    }
    if (cand.activityAt < best.activityAt) continue;

    if (cand.connectedAt > best.connectedAt) {
      best = cand;
      continue;
    }
    if (cand.connectedAt < best.connectedAt) continue;

    if (cand.connId > best.connId) {
      best = cand;
    }
  }

  return best?.connId;
}

