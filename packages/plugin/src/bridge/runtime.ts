import { AppEvents, SelectionType, type ReactRNPlugin } from '@remnote/plugin-sdk';

import { executeOp } from './ops/executeOp';
import type { OpDispatch, OpDispatchBatch, OpDispatchItem } from './ops/types';
import { sleep } from './shared/sleep';
import { BRIDGE_SETTING_IDS } from './settings';
import { computeOpLockKeys, OpLockManager } from './opConcurrency';
import { openWs, send, waitForOpOrNoWork } from './ws';

let controlWs: WebSocket | null = null;
let controlReconnectTimer: any = null;
let syncPollTimer: any = null;
let syncing = false;
let syncWatchdogTimer: any = null;
let syncRunSeq = 0;
let activeSyncRunId = 0;
let syncWatchdogTrippedUntil = 0;
let workerWs: WebSocket | null = null;
let controlDesired = false;
let controlConnSeq = 0;
let controlReconnectAttempt = 0;

let selectionForwarderRegistered = false;
let selectionForwarderInFlight = false;
let selectionForwarderPending = false;
let lastSelectionSignature: string | null = null;
let selectionPollTimer: any = null;
let selectionForwarderCallbacks: {
  editor: (() => void) | null;
  focusedRem: (() => void) | null;
  focusedPortal: (() => void) | null;
} | null = null;

let uiContextForwarderRegistered = false;
let uiContextForwarderInFlight = false;
let uiContextForwarderPending = false;
let uiContextForwarderPendingSource: string | null = null;
let lastUiContextSignature: string | null = null;
// Emit `[agent-remnote][ui-context]` logs when the UI context changes.
// `source` tells you what triggered it (e.g. `connect` / `event:*`).
const DEBUG_UI_CONTEXT_LOG = true;
let uiContextForwarderCallbacks: {
  url: (() => void) | null;
  openRem: (() => void) | null;
  focusedPane: (() => void) | null;
  windowTree: (() => void) | null;
  focusedRem: (() => void) | null;
  focusedPortal: (() => void) | null;
} | null = null;

const selectionListenerKeyBase = 'agent-remnote.selection-forwarder';
const selectionListenerKeys = {
  editor: `${selectionListenerKeyBase}.editor`,
  focusedRem: `${selectionListenerKeyBase}.focused-rem`,
  focusedPortal: `${selectionListenerKeyBase}.focused-portal`,
} as const;

const uiContextListenerKeyBase = 'agent-remnote.ui-context-forwarder';
const uiContextListenerKeys = {
  url: `${uiContextListenerKeyBase}.url`,
  openRem: `${uiContextListenerKeyBase}.open-rem`,
  focusedPane: `${uiContextListenerKeyBase}.focused-pane`,
  windowTree: `${uiContextListenerKeyBase}.window-tree`,
  focusedRem: `${uiContextListenerKeyBase}.focused-rem`,
  focusedPortal: `${uiContextListenerKeyBase}.focused-portal`,
  selection: `${uiContextListenerKeyBase}.selection`,
} as const;

const DEFAULT_SYNC_CONCURRENCY = 4;
const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_REQUEST_MAX_BYTES = 512_000;
const DEFAULT_REQUEST_MAX_OP_BYTES = 256_000;
const REQUEST_OPS_RETRY_MIN_DELAY_MS = 250;
const REQUEST_OPS_RETRY_MAX_DELAY_MS = 2000;
const REQUEST_OPS_RETRY_MAX_STREAK = 5;
const REQUEST_OPS_NON_RETRYABLE_CODES = new Set(['PROTOCOL_MISMATCH', 'INVALID_MESSAGE', 'UNSUPPORTED_CLIENT', 'UNSUPPORTED_VERSION']);
const LEASE_EXTEND_INITIAL_DELAY_MS = 20_000;
const LEASE_EXTEND_INTERVAL_MS = 30_000;
const opLocks = new OpLockManager();

type RequestOpsResult =
  | { readonly kind: 'ops'; readonly ops: readonly OpDispatchItem[] }
  | { readonly kind: 'no_work' }
  | {
      readonly kind: 'error';
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
    };

function isRetryableRequestOpsErrorCode(code: string): boolean {
  if (!code) return true;
  if (REQUEST_OPS_NON_RETRYABLE_CODES.has(code)) return false;
  return true;
}

function computeRequestOpsRetryDelayMs(streak: number): number {
  const safeStreak = Math.max(1, Math.floor(streak));
  const backoff = REQUEST_OPS_RETRY_MIN_DELAY_MS * Math.pow(2, Math.max(0, safeStreak - 1));
  return Math.min(REQUEST_OPS_RETRY_MAX_DELAY_MS, backoff);
}

type PendingAck = {
  readonly key: string;
  readonly op_id: string;
  readonly attempt_id: string;
  ws: WebSocket;
  payload: any;
  retries: number;
  nextRetryAt: number;
};

const pendingAcks = new Map<string, PendingAck>();
const ackWaiters = new Map<string, { resolve: (msg: any) => void; timer: any }>();
const ackListenerInstalled = new WeakSet<WebSocket>();
let ackFlushTimer: any = null;

const ACK_WAIT_TIMEOUT_MS = 1500;
const ACK_RETRY_MIN_DELAY_MS = 600;
const ACK_RETRY_MAX_DELAY_MS = 5000;

const leaseExtendRejections = new Map<string, { readonly reason: string; readonly at: number }>();
const leaseExtendListenerInstalled = new WeakSet<WebSocket>();

function clearAckRuntimeState() {
  if (ackFlushTimer) {
    try {
      clearTimeout(ackFlushTimer);
    } catch {}
    ackFlushTimer = null;
  }
  for (const waiter of ackWaiters.values()) {
    try {
      clearTimeout(waiter.timer);
    } catch {}
    try {
      waiter.resolve(null);
    } catch {}
  }
  ackWaiters.clear();
  pendingAcks.clear();
  leaseExtendRejections.clear();
}

export function resetRuntimeState() {
  try {
    stopControlChannel();
  } catch {}
  try {
    closeWorkerWs();
  } catch {}
  if (syncWatchdogTimer) {
    try {
      clearTimeout(syncWatchdogTimer);
    } catch {}
    syncWatchdogTimer = null;
  }
  if (syncPollTimer) {
    try {
      clearTimeout(syncPollTimer);
    } catch {}
    syncPollTimer = null;
  }
  syncing = false;
  activeSyncRunId = 0;
  syncWatchdogTrippedUntil = 0;
  clearAckRuntimeState();
}

export function __setRuntimeStateForTests(params: {
  readonly syncing?: boolean;
  readonly activeSyncRunId?: number;
  readonly syncWatchdogTrippedUntil?: number;
}) {
  if (typeof params.syncing === 'boolean') syncing = params.syncing;
  if (typeof params.activeSyncRunId === 'number') activeSyncRunId = params.activeSyncRunId;
  if (typeof params.syncWatchdogTrippedUntil === 'number') syncWatchdogTrippedUntil = params.syncWatchdogTrippedUntil;
}

export function __getRuntimeStateForTests() {
  return {
    syncing,
    activeSyncRunId,
    syncWatchdogTrippedUntil,
  };
}

function ackKey(opId: string, attemptId: string): string {
  return `${opId}:${attemptId}`;
}

function ensureLeaseExtendListener(ws: WebSocket) {
  if (leaseExtendListenerInstalled.has(ws)) return;
  leaseExtendListenerInstalled.add(ws);

  ws.addEventListener('message', (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(String((ev as any)?.data));
    } catch {
      return;
    }

    if (msg?.type !== 'LeaseExtendRejected' && msg?.type !== 'LeaseExtendOk') return;

    const opId = typeof msg?.op_id === 'string' ? msg.op_id : typeof msg?.opId === 'string' ? msg.opId : '';
    const attemptId =
      typeof msg?.attempt_id === 'string' ? msg.attempt_id : typeof msg?.attemptId === 'string' ? msg.attemptId : '';
    if (!opId || !attemptId) return;

    const key = ackKey(opId, attemptId);

    if (msg.type === 'LeaseExtendRejected') {
      if (leaseExtendRejections.has(key)) return;
      const reason = typeof msg?.reason === 'string' ? msg.reason : 'rejected';
      leaseExtendRejections.set(key, { reason, at: Date.now() });
      try {
        console.warn('[agent-remnote][lease] rejected', { opId, attemptId, reason, current: msg?.current });
      } catch {}
    } else {
      leaseExtendRejections.delete(key);
    }
  });
}

function startLeaseExtend(ws: WebSocket, opId: string, attemptId: string): () => void {
  ensureLeaseExtendListener(ws);
  const key = ackKey(opId, attemptId);

  let stopped = false;
  let timer: any = null;

  const tick = () => {
    if (stopped) return;
    if (leaseExtendRejections.has(key)) {
      stopped = true;
      return;
    }

    try {
      send(ws, { type: 'LeaseExtend', op_id: opId, attempt_id: attemptId, extendMs: DEFAULT_LEASE_MS });
    } catch {}

    timer = setTimeout(tick, LEASE_EXTEND_INTERVAL_MS);
  };

  timer = setTimeout(tick, LEASE_EXTEND_INITIAL_DELAY_MS);

  return () => {
    stopped = true;
    leaseExtendRejections.delete(key);
    if (timer) {
      try {
        clearTimeout(timer);
      } catch {}
    }
  };
}

function ensureAckListener(ws: WebSocket) {
  if (ackListenerInstalled.has(ws)) return;
  ackListenerInstalled.add(ws);

  ws.addEventListener('message', (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(String((ev as any)?.data));
    } catch {
      return;
    }

    if (msg?.type !== 'AckOk' && msg?.type !== 'AckRejected') return;

    const opId = typeof msg?.op_id === 'string' ? msg.op_id : typeof msg?.opId === 'string' ? msg.opId : '';
    const attemptId =
      typeof msg?.attempt_id === 'string' ? msg.attempt_id : typeof msg?.attemptId === 'string' ? msg.attemptId : '';
    if (!opId || !attemptId) return;

    const key = ackKey(opId, attemptId);
    pendingAcks.delete(key);

    const waiter = ackWaiters.get(key);
    if (waiter) {
      ackWaiters.delete(key);
      try {
        clearTimeout(waiter.timer);
      } catch {}
      waiter.resolve(msg);
    }

    if (msg.type === 'AckRejected') {
      // Avoid toast storms; emit a low-noise diagnostic event.
      try {
        console.warn('[agent-remnote][ack] rejected', { opId, attemptId, reason: msg?.reason, current: msg?.current });
      } catch {}
    }
  });
}

function scheduleAckFlush() {
  if (ackFlushTimer) return;
  ackFlushTimer = setTimeout(() => {
    ackFlushTimer = null;
    flushPendingAcks();
  }, 300);
}

function flushPendingAcks() {
  const now = Date.now();
  for (const ack of pendingAcks.values()) {
    if (!ack.ws || ack.ws.readyState !== WebSocket.OPEN) {
      pendingAcks.delete(ack.key);
      continue;
    }
    if (now < ack.nextRetryAt) continue;

    try {
      send(ack.ws, ack.payload);
    } catch {}

    ack.retries += 1;
    const backoff = Math.min(ACK_RETRY_MAX_DELAY_MS, ACK_RETRY_MIN_DELAY_MS + ack.retries * 500);
    ack.nextRetryAt = now + backoff;
  }

  if (pendingAcks.size > 0) scheduleAckFlush();
}

function waitForAck(key: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve) => {
    const existing = ackWaiters.get(key);
    if (existing) {
      try {
        clearTimeout(existing.timer);
      } catch {}
      ackWaiters.delete(key);
    }
    const timer = setTimeout(() => {
      ackWaiters.delete(key);
      resolve(null);
    }, Math.max(1, timeoutMs));
    ackWaiters.set(key, { resolve, timer });
  });
}

async function sendAckWithConfirm(ws: WebSocket, payload: any, timeoutMs = ACK_WAIT_TIMEOUT_MS): Promise<'ok' | 'rejected' | 'timeout'> {
  const opId = typeof payload?.op_id === 'string' ? payload.op_id : '';
  const attemptId = typeof payload?.attempt_id === 'string' ? payload.attempt_id : '';
  if (!opId || !attemptId) return 'timeout';

  ensureAckListener(ws);

  const key = ackKey(opId, attemptId);
  pendingAcks.set(key, {
    key,
    op_id: opId,
    attempt_id: attemptId,
    ws,
    payload,
    retries: 0,
    nextRetryAt: Date.now() + ACK_RETRY_MIN_DELAY_MS,
  });

  const waiter = waitForAck(key, timeoutMs);
  try {
    send(ws, payload);
  } catch {}

  const msg = await waiter;
  if (!msg) {
    scheduleAckFlush();
    return 'timeout';
  }
  return msg.type === 'AckOk' ? 'ok' : 'rejected';
}

// Best-effort watchdog to avoid a permanently stuck `syncing=true` state.
// Note: We can't reliably cancel arbitrary plugin SDK calls, so this is designed to be:
// - rare (large timeout)
// - noisy only when it trips (one toast)
// - safe for automated kicks (cooldown suppresses silent auto-retries)
const SYNC_WATCHDOG_TIMEOUT_MS = 180_000;
const SYNC_WATCHDOG_COOLDOWN_MS = 120_000;

function clampInt(value: unknown, def: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeSearchTerms(queryText: string): readonly string[] {
  const raw = String(queryText || '').trim();
  if (!raw) return [];
  const parts = raw
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const t = p.toLowerCase();
    if (t.length < 2) continue;
    if (out.includes(t)) continue;
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}

function buildSnippetAroundMatch(
  text: string,
  queryText: string,
  maxChars: number,
): { readonly text: string; readonly truncated: boolean } {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };

  const terms = normalizeSearchTerms(queryText);
  const lower = normalized.toLowerCase();

  let idx = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i < 0) continue;
    if (idx < 0 || i < idx) idx = i;
  }

  let start = 0;
  if (idx >= 0) {
    start = Math.max(0, idx - Math.floor(maxChars / 3));
  }
  let end = start + maxChars;
  if (end > normalized.length) {
    end = normalized.length;
    start = Math.max(0, end - maxChars);
  }

  const slice = normalized.slice(start, end).trim();
  const truncated = start > 0 || end < normalized.length;
  return { text: slice, truncated };
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function handleSearchRequest(plugin: ReactRNPlugin, ws: WebSocket, msg: any) {
  const startedAt = Date.now();
  const requestId = typeof msg?.requestId === 'string' ? msg.requestId.trim() : '';
  if (!requestId) return;

  const queryText = typeof msg?.queryText === 'string' ? msg.queryText : '';
  const searchContextRemId = typeof msg?.searchContextRemId === 'string' ? msg.searchContextRemId.trim() : '';

  const maxPreviewChars = 200;

  const limitRequested = clampInt(msg?.limit, 20, 1, 10_000);
  const limitEffective = clampInt(limitRequested, 20, 1, 100);
  const limitClamped = limitEffective !== limitRequested;

  const timeoutRequested = clampInt(msg?.timeoutMs, 3000, 1, 60_000);
  const timeoutMs = clampInt(timeoutRequested, 3000, 1, 5000);

  const baseBudget = {
    timeoutMs,
    limitRequested,
    limitEffective,
    limitClamped,
    maxPreviewChars,
    durationMs: 0,
  };

  const sendResponse = (payload: any) => {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    } catch {}
  };

  if (!queryText.trim()) {
    return sendResponse({
      type: 'SearchResponse',
      requestId,
      ok: false,
      budget: { ...baseBudget, durationMs: Date.now() - startedAt },
      error: { code: 'VALIDATION_ERROR', message: 'queryText must not be empty' },
    });
  }

  try {
    const queryRichText = await plugin.richText.parseFromMarkdown(queryText);
    const rems = await withTimeout(
      plugin.search.search(queryRichText, searchContextRemId || undefined, { numResults: limitEffective }),
      timeoutMs,
    );

    const results = [];
    for (const rem of rems.slice(0, limitEffective)) {
      const remId = String((rem as any)?._id || '').trim();
      if (!remId) continue;

      let title = '';
      try {
        title = String(await plugin.richText.toString((rem as any)?.text ?? []));
      } catch {}

      let snippet = '';
      try {
        if ((rem as any)?.backText) snippet = String(await plugin.richText.toString((rem as any).backText));
      } catch {}

      if (!snippet.trim()) {
        snippet = title;
      }
      const preview = buildSnippetAroundMatch(snippet, queryText, maxPreviewChars);
      results.push({ remId, title: title.trim(), snippet: preview.text, truncated: preview.truncated });
    }

    return sendResponse({
      type: 'SearchResponse',
      requestId,
      ok: true,
      budget: { ...baseBudget, durationMs: Date.now() - startedAt },
      results,
    });
  } catch (e: any) {
    const message = String(e?.message || e || 'search failed');
    const code = message.toLowerCase().includes('timeout') ? 'TIMEOUT' : 'PLUGIN_ERROR';
    return sendResponse({
      type: 'SearchResponse',
      requestId,
      ok: false,
      budget: { ...baseBudget, durationMs: Date.now() - startedAt },
      error: { code, message },
      nextActions: [
        'Retry later',
        'Check that the plugin is connected and responsive',
        'Fallback to DB search: agent-remnote read search --query "<keywords>"',
      ],
    });
  }
}

function stopSelectionPoll() {
  if (selectionPollTimer) {
    clearTimeout(selectionPollTimer);
    selectionPollTimer = null;
  }
}

function scheduleSelectionPoll(plugin: ReactRNPlugin) {
  if (selectionPollTimer) return;
  selectionPollTimer = setTimeout(() => {
    selectionPollTimer = null;
    if (!controlDesired) return;
    if (!controlWs || controlWs.readyState !== WebSocket.OPEN) return;
    void forwardSelectionSnapshot(plugin, { force: false });
    scheduleSelectionPoll(plugin);
  }, 500);
}

export function registerSelectionForwarder(plugin: ReactRNPlugin) {
  // Idempotent: RemNote may keep JS globals across plugin reload/update.
  // Always "ensure" listeners are installed with the correct global-event key (`undefined`).
  selectionForwarderRegistered = true;

  // IMPORTANT: For global events, the "listenerKey" is actually the *event key* and must be `undefined`.
  // If you pass a non-undefined key here, RemNote will not deliver the global event to this listener.
  // (See: https://plugins.remnote.com/advanced/events)
  try {
    const cb = selectionForwarderCallbacks?.editor;
    if (cb) plugin.event.removeListener(AppEvents.EditorSelectionChanged, undefined, cb as any);
  } catch {}
  try {
    const cb = selectionForwarderCallbacks?.focusedRem;
    if (cb) plugin.event.removeListener(AppEvents.FocusedRemChange, undefined, cb as any);
  } catch {}
  try {
    const cb = selectionForwarderCallbacks?.focusedPortal;
    if (cb) plugin.event.removeListener(AppEvents.FocusedPortalChange, undefined, cb as any);
  } catch {}
  try {
    plugin.event.removeListener(AppEvents.EditorSelectionChanged, selectionListenerKeys.editor as any);
  } catch {}
  try {
    plugin.event.removeListener(AppEvents.FocusedRemChange, selectionListenerKeys.focusedRem as any);
  } catch {}
  try {
    plugin.event.removeListener(AppEvents.FocusedPortalChange, selectionListenerKeys.focusedPortal as any);
  } catch {}

  const onEditor = () => {
    void forwardSelectionSnapshot(plugin, { force: false });
  };
  const onFocusedRem = () => {
    void forwardSelectionSnapshot(plugin, { force: false });
  };
  const onFocusedPortal = () => {
    void forwardSelectionSnapshot(plugin, { force: false });
  };
  selectionForwarderCallbacks = { editor: onEditor, focusedRem: onFocusedRem, focusedPortal: onFocusedPortal };

  plugin.event.addListener(AppEvents.EditorSelectionChanged, undefined, onEditor as any);
  plugin.event.addListener(AppEvents.FocusedRemChange, undefined, onFocusedRem as any);
  plugin.event.addListener(AppEvents.FocusedPortalChange, undefined, onFocusedPortal as any);
}

export function unregisterSelectionForwarder(plugin: ReactRNPlugin) {
  if (!selectionForwarderRegistered) return;
  selectionForwarderRegistered = false;
  selectionForwarderInFlight = false;
  selectionForwarderPending = false;
  lastSelectionSignature = null;
  stopSelectionPoll();
  try {
    const cb = selectionForwarderCallbacks?.editor;
    plugin.event.removeListener(AppEvents.EditorSelectionChanged, undefined, cb as any);
  } catch {}
  try {
    const cb = selectionForwarderCallbacks?.focusedRem;
    plugin.event.removeListener(AppEvents.FocusedRemChange, undefined, cb as any);
  } catch {}
  try {
    const cb = selectionForwarderCallbacks?.focusedPortal;
    plugin.event.removeListener(AppEvents.FocusedPortalChange, undefined, cb as any);
  } catch {}
  selectionForwarderCallbacks = null;
}

export function registerUiContextForwarder(plugin: ReactRNPlugin) {
  // Idempotent: RemNote may keep JS globals across plugin reload/update.
  // Always "ensure" listeners are installed with the correct global-event key (`undefined`).
  uiContextForwarderRegistered = true;

  // Clean up legacy listeners that used a non-undefined key (they would never fire for global events).
  try {
    const cb = uiContextForwarderCallbacks?.url;
    if (cb) plugin.event.removeListener(AppEvents.URLChange, undefined, cb as any);
  } catch {}
  try {
    const cb = uiContextForwarderCallbacks?.openRem;
    if (cb) plugin.event.removeListener(AppEvents.GlobalOpenRem, undefined, cb as any);
  } catch {}
  try {
    const cb = uiContextForwarderCallbacks?.focusedPane;
    if (cb) plugin.event.removeListener(AppEvents.FocusedPaneChange, undefined, cb as any);
  } catch {}
  try {
    const cb = uiContextForwarderCallbacks?.windowTree;
    if (cb) plugin.event.removeListener(AppEvents.CurrentWindowTreeChange, undefined, cb as any);
  } catch {}
  try {
    const cb = uiContextForwarderCallbacks?.focusedRem;
    if (cb) plugin.event.removeListener(AppEvents.FocusedRemChange, undefined, cb as any);
  } catch {}
  try {
    const cb = uiContextForwarderCallbacks?.focusedPortal;
    if (cb) plugin.event.removeListener(AppEvents.FocusedPortalChange, undefined, cb as any);
  } catch {}
  try {
    plugin.event.removeListener(AppEvents.URLChange, uiContextListenerKeys.url as any);
  } catch {}
  try {
    plugin.event.removeListener(AppEvents.GlobalOpenRem, uiContextListenerKeys.openRem as any);
  } catch {}
  try {
    plugin.event.removeListener(AppEvents.FocusedPaneChange, uiContextListenerKeys.focusedPane as any);
  } catch {}
  try {
    plugin.event.removeListener(AppEvents.CurrentWindowTreeChange, uiContextListenerKeys.windowTree as any);
  } catch {}
  try {
    plugin.event.removeListener(AppEvents.FocusedRemChange, uiContextListenerKeys.focusedRem as any);
  } catch {}
  try {
    plugin.event.removeListener(AppEvents.FocusedPortalChange, uiContextListenerKeys.focusedPortal as any);
  } catch {}
  try {
    plugin.event.removeListener(AppEvents.EditorSelectionChanged, uiContextListenerKeys.selection as any);
  } catch {}

  const onUrl = () => void forwardUiContextSnapshot(plugin, { force: false, source: 'event:URLChange' });
  const onOpenRem = () => void forwardUiContextSnapshot(plugin, { force: false, source: 'event:GlobalOpenRem' });
  const onFocusedPane = () =>
    void forwardUiContextSnapshot(plugin, { force: false, source: 'event:FocusedPaneChange' });
  const onWindowTree = () =>
    void forwardUiContextSnapshot(plugin, { force: false, source: 'event:CurrentWindowTreeChange' });
  const onFocusedRem = () => void forwardUiContextSnapshot(plugin, { force: false, source: 'event:FocusedRemChange' });
  const onFocusedPortal = () =>
    void forwardUiContextSnapshot(plugin, { force: false, source: 'event:FocusedPortalChange' });
  uiContextForwarderCallbacks = {
    url: onUrl,
    openRem: onOpenRem,
    focusedPane: onFocusedPane,
    windowTree: onWindowTree,
    focusedRem: onFocusedRem,
    focusedPortal: onFocusedPortal,
  };

  plugin.event.addListener(AppEvents.URLChange, undefined, onUrl as any);
  plugin.event.addListener(AppEvents.GlobalOpenRem, undefined, onOpenRem as any);
  plugin.event.addListener(AppEvents.FocusedPaneChange, undefined, onFocusedPane as any);
  plugin.event.addListener(AppEvents.CurrentWindowTreeChange, undefined, onWindowTree as any);
  plugin.event.addListener(AppEvents.FocusedRemChange, undefined, onFocusedRem as any);
  plugin.event.addListener(AppEvents.FocusedPortalChange, undefined, onFocusedPortal as any);
}

export function unregisterUiContextForwarder(plugin: ReactRNPlugin) {
  if (!uiContextForwarderRegistered) return;
  uiContextForwarderRegistered = false;
  uiContextForwarderInFlight = false;
  uiContextForwarderPending = false;
  lastUiContextSignature = null;
  try {
    const cb = uiContextForwarderCallbacks?.url;
    plugin.event.removeListener(AppEvents.URLChange, undefined, cb as any);
  } catch {}
  try {
    const cb = uiContextForwarderCallbacks?.openRem;
    plugin.event.removeListener(AppEvents.GlobalOpenRem, undefined, cb as any);
  } catch {}
  try {
    const cb = uiContextForwarderCallbacks?.focusedPane;
    plugin.event.removeListener(AppEvents.FocusedPaneChange, undefined, cb as any);
  } catch {}
  try {
    const cb = uiContextForwarderCallbacks?.windowTree;
    plugin.event.removeListener(AppEvents.CurrentWindowTreeChange, undefined, cb as any);
  } catch {}
  try {
    const cb = uiContextForwarderCallbacks?.focusedRem;
    plugin.event.removeListener(AppEvents.FocusedRemChange, undefined, cb as any);
  } catch {}
  try {
    const cb = uiContextForwarderCallbacks?.focusedPortal;
    plugin.event.removeListener(AppEvents.FocusedPortalChange, undefined, cb as any);
  } catch {}
  try {
    plugin.event.removeListener(AppEvents.EditorSelectionChanged, uiContextListenerKeys.selection as any);
  } catch {}
  uiContextForwarderCallbacks = null;
}

async function forwardSelectionSnapshot(plugin: ReactRNPlugin, opts: { force: boolean }) {
  if (selectionForwarderInFlight) {
    selectionForwarderPending = true;
    return;
  }
  selectionForwarderInFlight = true;
  try {
    const ws = controlWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const snap = await getAgentSelectionSnapshot(plugin);

    let kindOut: AgentSelectionSnapshot['kind'] = snap.kind;
    let selectionTypeOut = kindOut === 'rem' ? SelectionType.Rem : kindOut === 'text' ? SelectionType.Text : undefined;
    let totalCount = 0;
    let truncated = false;
    let remIdsOut: string[] = [];
    let textRemId = '';
    let textRange: { start: number; end: number } | undefined = undefined;
    let textIsReverse = false;

    if (snap.kind === 'rem') {
      remIdsOut = snap.remIds;
      totalCount = remIdsOut.length;
      const maxIds = 200;
      truncated = totalCount > maxIds;
      if (truncated) remIdsOut = remIdsOut.slice(0, maxIds);
      if (totalCount <= 0) {
        kindOut = 'none';
        selectionTypeOut = undefined;
      }
    } else if (snap.kind === 'text') {
      textRemId = snap.remId;
      textRange = snap.range;
      textIsReverse = snap.isReverse;
      totalCount = 1;
    }

    // If the focused Rem is outside the current selection, treat the selection as cleared.
    // This matches the user-visible UI: focusing a different Rem without selection should not retain stale selection.
    if (kindOut === 'rem' && remIdsOut.length > 0 && !truncated) {
      let focusedRemId = '';
      try {
        const r: any = await plugin.focus.getFocusedRem();
        if (r?._id) focusedRemId = String(r._id).trim();
      } catch {}

      if (focusedRemId && !remIdsOut.includes(focusedRemId)) {
        kindOut = 'none';
        selectionTypeOut = undefined;
        totalCount = 0;
        truncated = false;
        remIdsOut = [];
      }
    }

    if (kindOut === 'text' && textRemId) {
      let focusedRemId = '';
      try {
        const r: any = await plugin.focus.getFocusedRem();
        if (r?._id) focusedRemId = String(r._id).trim();
      } catch {}

      if (focusedRemId && focusedRemId !== textRemId) {
        kindOut = 'none';
        selectionTypeOut = undefined;
        totalCount = 0;
        truncated = false;
        textRemId = '';
        textRange = undefined;
        textIsReverse = false;
      }
    }

    const signature =
      kindOut === 'rem'
        ? `rem:${totalCount}:${truncated ? '1' : '0'}:${remIdsOut.join(',')}`
        : kindOut === 'text'
          ? `text:${textRemId}:${textRange?.start ?? ''}-${textRange?.end ?? ''}:${textIsReverse ? '1' : '0'}`
          : 'none';
    if (!opts.force && lastSelectionSignature === signature) return;
    lastSelectionSignature = signature;

    try {
      ws.send(
        JSON.stringify({
          type: 'SelectionChanged',
          kind: kindOut,
          selectionType: selectionTypeOut,
          remIds: remIdsOut,
          totalCount,
          truncated,
          remId: textRemId,
          range: textRange,
          isReverse: textIsReverse,
          ts: Date.now(),
        }),
      );
    } catch {}
  } finally {
    selectionForwarderInFlight = false;
    if (selectionForwarderPending) {
      selectionForwarderPending = false;
      void forwardSelectionSnapshot(plugin, { force: false });
    }
  }
}

export type AgentSelectionSnapshot =
  | { readonly kind: 'none' }
  | { readonly kind: 'rem'; readonly remIds: string[] }
  | {
      readonly kind: 'text';
      readonly remId: string;
      readonly range: { start: number; end: number };
      readonly isReverse: boolean;
    };

export async function getAgentSelectionSnapshot(plugin: ReactRNPlugin): Promise<AgentSelectionSnapshot> {
  try {
    const sel: any = await plugin.editor.getSelection();
    if (!sel?.type) return { kind: 'none' };
    if (sel.type === SelectionType.Rem) {
      const ids = Array.isArray(sel.remIds) ? sel.remIds.filter((x: any) => typeof x === 'string' && x.trim()) : [];
      return { kind: 'rem', remIds: ids };
    }
    if (sel.type === SelectionType.Text) {
      const remId = typeof sel.remId === 'string' ? sel.remId.trim() : '';
      const startRaw = sel?.range?.start;
      const endRaw = sel?.range?.end;
      const start = typeof startRaw === 'number' && Number.isFinite(startRaw) ? Math.floor(startRaw) : NaN;
      const end = typeof endRaw === 'number' && Number.isFinite(endRaw) ? Math.floor(endRaw) : NaN;
      const isReverse = sel?.isReverse === true;

      if (!remId) return { kind: 'none' };
      if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: 'none' };
      // IMPORTANT: caret (collapsed range) is Focus, not Selection.
      if (start === end) return { kind: 'none' };
      return { kind: 'text', remId, range: { start, end }, isReverse };
    }

    // NOTE: PDF/WebReader selections are not included in the agent selection snapshot yet.
    return { kind: 'none' };
  } catch {
    return { kind: 'none' };
  }
}

async function readUiContextSnapshot(plugin: ReactRNPlugin): Promise<{
  url: string;
  paneId: string;
  pageRemId: string;
  focusedRemId: string;
  focusedPortalId: string;
  kbId: string;
  kbName: string;
}> {
  let url = '';
  try {
    url = (await plugin.window.getURL()) || '';
  } catch {}

  let paneId = '';
  try {
    paneId = (await plugin.window.getFocusedPaneId()) || '';
  } catch {}

  let pageRemId = '';
  try {
    pageRemId = (await plugin.window.getOpenPaneRemId(paneId)) || '';
  } catch {}

  let focusedRemId = '';
  try {
    const r: any = await plugin.focus.getFocusedRem();
    if (r?._id) focusedRemId = String(r._id);
  } catch {}

  let focusedPortalId = '';
  try {
    const r: any = await plugin.focus.getFocusedPortal();
    if (r?._id) focusedPortalId = String(r._id);
  } catch {}

  let kbId = '';
  let kbName = '';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'w') {
      kbId = String(parts[1] || '');
    }
  } catch {}

  if (!kbId) {
    try {
      const kb: any = await (plugin as any).kb?.getCurrentKnowledgeBaseData?.();
      if (kb?._id) kbId = String(kb._id);
      if (kb?.name) kbName = String(kb.name);
    } catch {}
  }

  return { url, paneId, pageRemId, focusedRemId, focusedPortalId, kbId, kbName };
}

async function forwardUiContextSnapshot(plugin: ReactRNPlugin, opts: { force: boolean; source: string }) {
  if (uiContextForwarderInFlight) {
    uiContextForwarderPending = true;
    uiContextForwarderPendingSource = opts.source;
    return;
  }
  uiContextForwarderInFlight = true;
  try {
    const ws = controlWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const snap = await readUiContextSnapshot(plugin);
    const signature = `${snap.url}|${snap.paneId}|${snap.pageRemId}|${snap.focusedRemId}|${snap.focusedPortalId}|${snap.kbId}`;
    if (!opts.force && lastUiContextSignature === signature) return;
    lastUiContextSignature = signature;

    try {
      ws.send(
        JSON.stringify({
          type: 'UiContextChanged',
          ...snap,
          source: opts.source,
          ts: Date.now(),
        }),
      );
    } catch {}
    if (DEBUG_UI_CONTEXT_LOG) {
      try {
        // eslint-disable-next-line no-console
        console.log('[agent-remnote][ui-context]', { ...snap, source: opts.source });
      } catch {}
    }
  } finally {
    uiContextForwarderInFlight = false;
    if (uiContextForwarderPending) {
      const source = uiContextForwarderPendingSource || 'pending';
      uiContextForwarderPending = false;
      uiContextForwarderPendingSource = null;
      void forwardUiContextSnapshot(plugin, { force: false, source });
    }
  }
}

function computeControlReconnectDelayMs(attempt: number): number {
  const baseMs = 500;
  const maxMs = 30_000;
  const cappedAttempt = Math.min(Math.max(attempt, 0), 10);
  const exp = Math.min(maxMs, baseMs * Math.pow(2, cappedAttempt));
  const jitter = exp * 0.2;
  return Math.max(0, Math.round(exp + (Math.random() * 2 - 1) * jitter));
}

export function stopControlChannel() {
  controlDesired = false;
  if (controlReconnectTimer) {
    clearTimeout(controlReconnectTimer);
    controlReconnectTimer = null;
  }
  if (syncPollTimer) {
    clearTimeout(syncPollTimer);
    syncPollTimer = null;
  }
  stopSelectionPoll();
  // Increment conn seq to invalidate old event handlers.
  controlConnSeq += 1;
  controlReconnectAttempt = 0;
  const ws = controlWs;
  controlWs = null;
  try {
    if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
  } catch {}
}

export function startControlChannel(plugin: ReactRNPlugin, url: string, clientInstanceId: string) {
  controlDesired = true;
  // Avoid creating multiple connections when OPEN/CONNECTING.
  if (controlWs && (controlWs.readyState === WebSocket.OPEN || controlWs.readyState === WebSocket.CONNECTING)) return;
  if (controlReconnectTimer) {
    clearTimeout(controlReconnectTimer);
    controlReconnectTimer = null;
  }

  const seq = (controlConnSeq += 1);
  const ws = new WebSocket(url);
  controlWs = ws;
  const isCurrent = () => controlWs === ws && controlConnSeq === seq;
  const connectTimeout = setTimeout(() => {
    if (!isCurrent()) return;
    if (ws.readyState === WebSocket.CONNECTING) {
      try {
        ws.close();
      } catch {}
    }
  }, 8_000);

  ws.onopen = async () => {
    if (!isCurrent()) return;
    clearTimeout(connectTimeout);
    // Reset backoff.
    controlReconnectAttempt = 0;
    try {
      ws.send(JSON.stringify({ type: 'Hello' }));
      ws.send(
        JSON.stringify({
          type: 'Register',
          protocolVersion: 2,
          clientType: 'remnote-plugin',
          clientInstanceId,
          capabilities: { control: true, worker: true, readRpc: true, batchPull: true },
        }),
      );
      // Push a selection snapshot immediately (avoid waiting for the next selection event).
      lastSelectionSignature = null;
      void forwardSelectionSnapshot(plugin, { force: true });
      lastUiContextSignature = null;
      void forwardUiContextSnapshot(plugin, { force: true, source: 'connect' });
      scheduleSelectionPoll(plugin);
      await plugin.app.toast('Control channel connected');
      // Auto-sync (optional).
      const autoSync = await plugin.settings.getSetting<boolean>(BRIDGE_SETTING_IDS.autoSyncOnConnect);
      if (autoSync) {
        // Use silent mode for automatic sync.
        try {
          await runSyncLoop(plugin, url, clientInstanceId, { silent: true });
        } catch (e: any) {
          try {
            console.warn('[agent-remnote][control] auto-sync on connect failed', {
              message: String(e?.message || e || 'unknown error'),
            });
          } catch {}
        }
      }
    } catch {}
  };

  ws.onmessage = async (ev) => {
    if (!isCurrent()) return;
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg?.type === 'StartSync') {
        // StartSync is a server-side trigger (notify/kick). Default to silent drain to avoid UI spam.
        try {
          await runSyncLoop(plugin, url, clientInstanceId, { silent: true });
        } catch (e: any) {
          try {
            console.warn('[agent-remnote][control] StartSync failed', {
              message: String(e?.message || e || 'unknown error'),
            });
          } catch {}
        }
        return;
      }
      if (msg?.type === 'SearchRequest') {
        void handleSearchRequest(plugin, ws, msg);
        return;
      }
    } catch {}
  };

  const scheduleReconnect = () => {
    if (!controlDesired) return;
    if (!isCurrent()) return;
    if (controlReconnectTimer) return;
    const delayMs = computeControlReconnectDelayMs(controlReconnectAttempt);
    controlReconnectAttempt += 1;
    controlReconnectTimer = setTimeout(() => {
      controlReconnectTimer = null;
      startControlChannel(plugin, url, clientInstanceId);
    }, delayMs);
  };

  ws.onclose = () => {
    clearTimeout(connectTimeout);
    if (!isCurrent()) return;
    stopSelectionPoll();
    scheduleReconnect();
    controlWs = null;
  };
  ws.onerror = () => {
    clearTimeout(connectTimeout);
    stopSelectionPoll();
    scheduleReconnect();
  };
}

async function getOrOpenWorkerWs(url: string, preferControl = true): Promise<WebSocket> {
  if (preferControl && controlWs && controlWs.readyState === WebSocket.OPEN) return controlWs;
  if (workerWs && workerWs.readyState === WebSocket.OPEN) return workerWs;
  workerWs = await openWs(url);
  workerWs.onclose = () => {
    if (workerWs && workerWs.readyState !== WebSocket.OPEN) workerWs = null;
  };
  ensureAckListener(workerWs);
  return workerWs;
}

async function requestOps(ws: WebSocket, maxOps: number): Promise<RequestOpsResult> {
  const max = Math.max(1, Math.min(50, Math.floor(maxOps)));
  send(ws, {
    type: 'RequestOps',
    leaseMs: DEFAULT_LEASE_MS,
    maxOps: max,
    maxBytes: DEFAULT_REQUEST_MAX_BYTES,
    maxOpBytes: DEFAULT_REQUEST_MAX_OP_BYTES,
  });

  const msg: any = await waitForOpOrNoWork(ws);
  if (!msg || msg.type === 'NoWork') {
    return { kind: 'no_work' };
  }

  if (msg.type === 'Error') {
    const code = typeof msg?.code === 'string' ? msg.code : '';
    const message = typeof msg?.message === 'string' ? msg.message : '';

    if (code === 'OP_PAYLOAD_TOO_LARGE') {
      try {
        send(ws, { type: 'TriggerStartSync' });
      } catch {}
    }

    try {
      console.warn('[agent-remnote][ws] RequestOps error', {
        code,
        message,
        details: msg?.details,
        nextActions: msg?.nextActions,
      });
    } catch {}

    return {
      kind: 'error',
      code,
      message,
      retryable: isRetryableRequestOpsErrorCode(code),
    };
  }

  if (msg.type === 'OpDispatchBatch') {
    const batch = msg as OpDispatchBatch;
    const ops = Array.isArray(batch.ops) ? batch.ops : [];
    return { kind: 'ops', ops };
  }

  if (msg.type === 'OpDispatch') {
    const op = msg as any;
    if (op?.op_id && op?.attempt_id) {
      const item: OpDispatchItem = {
        op_id: String(op.op_id),
        attempt_id: String(op.attempt_id),
        txn_id: String(op.txn_id ?? ''),
        op_seq: Number(op.op_seq ?? 0),
        op_type: String(op.op_type ?? ''),
        payload: op.payload ?? null,
        idempotency_key: op.idempotency_key ?? null,
        lease_expires_at: typeof op.lease_expires_at === 'number' ? op.lease_expires_at : undefined,
      };
      return { kind: 'ops', ops: [item] };
    }
  }

  return { kind: 'no_work' };
}

export async function runSyncLoop(
  plugin: ReactRNPlugin,
  url: string,
  clientInstanceId: string,
  opts?: { silent?: boolean },
) {
  const now = Date.now();
  if (opts?.silent && syncWatchdogTrippedUntil > now) {
    return;
  }
  if (syncing) {
    if (!opts?.silent) await plugin.app.toast('A sync is already running');
    return;
  }
  syncing = true;
  const runId = (syncRunSeq += 1);
  activeSyncRunId = runId;
  if (syncWatchdogTimer) {
    clearTimeout(syncWatchdogTimer);
    syncWatchdogTimer = null;
  }
  syncWatchdogTimer = setTimeout(() => {
    if (!syncing) return;
    if (activeSyncRunId !== runId) return;
    activeSyncRunId = 0;
    syncing = false;
    syncWatchdogTrippedUntil = Date.now() + SYNC_WATCHDOG_COOLDOWN_MS;
    syncWatchdogTimer = null;
    try {
      closeWorkerWs();
    } catch {}
    try {
      if (controlWs && controlWs.readyState !== WebSocket.CLOSED) controlWs.close();
    } catch {}
    try {
      void plugin.app.toast('Sync watchdog tripped; please retry');
    } catch {}
  }, SYNC_WATCHDOG_TIMEOUT_MS);
  if (!opts?.silent) await plugin.app.toast('Starting sync…');
  let processed = 0;
  try {
	    const ws = await getOrOpenWorkerWs(url, /*preferControl*/ true);
	    ensureAckListener(ws);
	    const isControl = ws === controlWs;
    // Hello/Register are idempotent; controlWs may have already sent them.
    try {
      send(ws, { type: 'Hello' });
    } catch {}
    try {
      send(ws, {
        type: 'Register',
        protocolVersion: 2,
        clientType: 'remnote-plugin',
        clientInstanceId,
        capabilities: { control: isControl, worker: true, readRpc: true, batchPull: true },
      });
    } catch {}

    let maxConcurrency = DEFAULT_SYNC_CONCURRENCY;
    try {
      const raw = await plugin.settings.getSetting<number>(BRIDGE_SETTING_IDS.syncConcurrency);
      if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) maxConcurrency = Math.min(16, Math.floor(raw));
    } catch {}

    const inFlight = new Map<string, Promise<void>>();
    let noWork = false;

    const runOne = async (op: OpDispatch) => {
      let release: (() => void) | undefined;
      let stopLeaseExtend: (() => void) | undefined;
      try {
        const keys = await computeOpLockKeys(plugin, op);
        release = await opLocks.acquire(keys);
        stopLeaseExtend = startLeaseExtend(ws, op.op_id, op.attempt_id);
        const result = await executeOp(plugin, op);
        if (result && (result as any).ok) {
          await sendAckWithConfirm(ws, { type: 'OpAck', op_id: op.op_id, attempt_id: op.attempt_id, status: 'success', result });
        } else {
          const fatal = (result && (result as any).fatal) || false;
          const errMsg = (result && (result as any).error) || 'executor error';
          await sendAckWithConfirm(ws, {
            type: 'OpAck',
            op_id: op.op_id,
            attempt_id: op.attempt_id,
            status: fatal ? 'failed' : 'retry',
            error_code: 'EXEC_ERROR',
            error_message: errMsg,
          });
        }
      } catch (e: any) {
        const msg = String(e?.message || e);
        await sendAckWithConfirm(ws, {
          type: 'OpAck',
          op_id: op.op_id,
          attempt_id: op.attempt_id,
          status: 'retry',
          error_code: 'EXEC_ERROR',
          error_message: msg,
        });
      } finally {
        try {
          stopLeaseExtend?.();
        } catch {}
        try {
          release?.();
        } catch {}
        processed += 1;
        if (processed % 10 === 0) {
          await sleep(50);
        }
      }
    };

    let requestOpsErrorStreak = 0;

    while (true) {
      while (!noWork && inFlight.size < maxConcurrency) {
        const want = maxConcurrency - inFlight.size;
        const pull = await requestOps(ws, want);

        if (pull.kind === 'error') {
          requestOpsErrorStreak += 1;
          const shouldRetry = pull.retryable && requestOpsErrorStreak <= REQUEST_OPS_RETRY_MAX_STREAK;
          if (shouldRetry) {
            const delayMs = computeRequestOpsRetryDelayMs(requestOpsErrorStreak);
            try {
              console.warn('[agent-remnote][ws] RequestOps transient error; retrying', {
                code: pull.code,
                message: pull.message,
                streak: requestOpsErrorStreak,
                delayMs,
              });
            } catch {}
            await sleep(delayMs);
            continue;
          }

          try {
            console.warn('[agent-remnote][ws] RequestOps error; stopping pull loop', {
              code: pull.code,
              message: pull.message,
              streak: requestOpsErrorStreak,
              retryable: pull.retryable,
            });
          } catch {}
          noWork = true;
          break;
        }

        requestOpsErrorStreak = 0;

        if (pull.kind === 'no_work') {
          noWork = true;
          break;
        }

        const batch = pull.ops;
        if (batch.length === 0) {
          noWork = true;
          break;
        }

        for (const item of batch) {
          const op: OpDispatch = { type: 'OpDispatch', ...item };
          const p = runOne(op)
            .catch(() => {})
            .finally(() => {
              inFlight.delete(op.op_id);
            });
          inFlight.set(op.op_id, p);
        }
      }

      if (noWork && inFlight.size === 0) break;
      if (inFlight.size > 0) await Promise.race(inFlight.values());
    }

    // Keep the control channel connection; close the worker connection.
    if (ws !== controlWs) {
      try {
        ws.close();
      } catch {}
      if (workerWs === ws) workerWs = null;
    }
    if (!opts?.silent) await plugin.app.toast('Sync finished (or no work)');
  } finally {
    syncing = false;
    if (activeSyncRunId === runId) {
      activeSyncRunId = 0;
      if (syncWatchdogTimer) {
        clearTimeout(syncWatchdogTimer);
        syncWatchdogTimer = null;
      }
    }
    // If control channel is connected and auto-sync is enabled, schedule a light poll
    // to drain any follow-up ops that arrive shortly after.
    try {
      const autoSync = await plugin.settings.getSetting<boolean>(BRIDGE_SETTING_IDS.autoSyncOnConnect);
      if (processed > 0 && autoSync && controlDesired && controlWs && controlWs.readyState === WebSocket.OPEN) {
        if (!syncPollTimer) {
          syncPollTimer = setTimeout(() => {
            syncPollTimer = null;
            if (!controlDesired) return;
            if (!controlWs || controlWs.readyState !== WebSocket.OPEN) return;
            if (syncing) return;
            runSyncLoop(plugin, url, clientInstanceId, { silent: true });
          }, 1500);
        }
      }
    } catch {}
  }
}

export function closeWorkerWs() {
  try {
    if (workerWs && workerWs.readyState !== WebSocket.CLOSED) workerWs.close();
  } catch {}
  workerWs = null;
}
