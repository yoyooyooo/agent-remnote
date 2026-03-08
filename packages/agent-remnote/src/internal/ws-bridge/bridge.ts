import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { resolveUserFilePath } from '../../lib/paths.js';
import { requestTmuxStatusLineRefresh } from '../../lib/tmux.js';
import { resolveStateFilePath } from '../../lib/wsState.js';
import { buildDbFallbackNextAction } from '../../lib/wsBridgeNextActions.js';
import { wsLog } from '../../lib/wsDebug.js';

import { defaultQueuePath, openQueueDb } from '../queue/index.js';

import { makeWsBridgeCore } from '../../lib/wsBridgeCore.js';
import type { WsBridgeCoreAction, WsBridgeCoreConfig } from '../../lib/wsBridgeCoreTypes.js';

export type WsBridgeOptions = {
  port?: number;
  path?: string;
  host?: string;
  enable?: boolean;
  heartbeatIntervalMs?: number;
  queueDbPath?: string;
  stateFilePath?: string;
  stateFileDisabled?: boolean;
  buildDbFallbackNextAction?: (queryText: string) => string;
};

export type StartedWsBridge = {
  wss: WebSocketServer;
  close: () => Promise<void>;
};

const GLOBAL_BRIDGE_KEY = Symbol.for('__REMNOTE_WS_BRIDGE__');
const globalAny = globalThis as any;

function isWssListening(wss: WebSocketServer | undefined): boolean {
  if (!wss) return false;
  try {
    const addr = wss.address();
    if (!addr) return false;
    if (typeof addr === 'string') return addr.length > 0;
    if (typeof (addr as any).port === 'number') return true;
    return false;
  } catch {
    return false;
  }
}

function getStoredBridge(): StartedWsBridge | undefined {
  const existing: StartedWsBridge | undefined = globalAny[GLOBAL_BRIDGE_KEY];
  if (!existing) return undefined;
  if (!isWssListening(existing.wss)) {
    setStoredBridge(undefined);
    return undefined;
  }
  return existing;
}

function setStoredBridge(bridge: StartedWsBridge | undefined) {
  if (bridge) {
    globalAny[GLOBAL_BRIDGE_KEY] = bridge;
  } else {
    delete globalAny[GLOBAL_BRIDGE_KEY];
  }
}

function resolveBridgeStateFilePath(params?: {
  readonly disabled?: boolean | undefined;
  readonly path?: string | undefined;
}): string | undefined {
  if (params?.disabled === true) return undefined;

  const explicit = String(params?.path || '').trim();
  if (explicit) {
    const resolved = resolveUserFilePath(explicit);
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
    } catch {}
    return resolved;
  }

  const resolved = resolveStateFilePath();
  if (resolved.disabled) return undefined;
  try {
    fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
  } catch {}
  return resolved.path;
}

function envEnabled(): boolean {
  const flag = (process.env.REMNOTE_WS_ENABLED || process.env.WS_ENABLED || '').toLowerCase();
  const disabled = (process.env.REMNOTE_WS_DISABLED || process.env.NO_WS || '').toLowerCase();
  if (disabled === '1' || disabled === 'true') return false;
  if (flag === '0' || flag === 'false') return false;
  return true;
}

function envActiveWorkerStaleMs(def = 90_000): number {
  const raw = process.env.REMNOTE_WS_ACTIVE_STALE_MS || process.env.WS_ACTIVE_STALE_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return Math.max(1, Math.floor(def));
}

function normalizeBooleanValue(raw: string | undefined): boolean | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!v) return null;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return false;
  return null;
}

function envWsSchedulerEnabled(def = true): boolean {
  const v = normalizeBooleanValue(process.env.REMNOTE_WS_SCHEDULER);
  return v === null ? def : v;
}

function envDispatchMaxBytes(def = 512_000): number {
  const raw = process.env.REMNOTE_WS_DISPATCH_MAX_BYTES;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return Math.max(1, Math.floor(def));
}

function envDispatchMaxOpBytes(def = 256_000): number {
  const raw = process.env.REMNOTE_WS_DISPATCH_MAX_OP_BYTES;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return Math.max(1, Math.floor(def));
}

type KickConfig = {
  readonly enabled: boolean;
  readonly intervalMs: number;
  readonly cooldownMs: number;
  readonly noProgressWarnMs: number;
  readonly noProgressEscalateMs: number;
};

const DEFAULT_KICK_CONFIG: KickConfig = {
  enabled: true,
  intervalMs: 30_000,
  cooldownMs: 15_000,
  noProgressWarnMs: 30_000,
  noProgressEscalateMs: 90_000,
};

function readEnvInt(keys: readonly string[], def: number, min: number, max: number): number {
  for (const k of keys) {
    const raw = process.env[k];
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }
  return def;
}

function envKickConfig(): KickConfig {
  const enabledRaw = normalizeBooleanValue(process.env.REMNOTE_WS_KICK_ENABLED || process.env.WS_KICK_ENABLED);
  const enabled = enabledRaw === null ? DEFAULT_KICK_CONFIG.enabled : enabledRaw;

  const intervalMs = readEnvInt(
    ['REMNOTE_WS_KICK_INTERVAL_MS', 'WS_KICK_INTERVAL_MS'],
    DEFAULT_KICK_CONFIG.intervalMs,
    0,
    60 * 60_000,
  );
  const cooldownMs = readEnvInt(
    ['REMNOTE_WS_KICK_COOLDOWN_MS', 'WS_KICK_COOLDOWN_MS'],
    DEFAULT_KICK_CONFIG.cooldownMs,
    0,
    60 * 60_000,
  );
  const noProgressWarnMs = readEnvInt(
    ['REMNOTE_WS_KICK_NO_PROGRESS_WARN_MS', 'WS_KICK_NO_PROGRESS_WARN_MS'],
    DEFAULT_KICK_CONFIG.noProgressWarnMs,
    0,
    60 * 60_000,
  );
  const noProgressEscalateMs = readEnvInt(
    ['REMNOTE_WS_KICK_NO_PROGRESS_ESCALATE_MS', 'WS_KICK_NO_PROGRESS_ESCALATE_MS'],
    DEFAULT_KICK_CONFIG.noProgressEscalateMs,
    0,
    60 * 60_000,
  );

  return { enabled, intervalMs, cooldownMs, noProgressWarnMs, noProgressEscalateMs };
}

function writeJsonAtomic(filePath: string, json: unknown): void {
  const resolved = resolveUserFilePath(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmp = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, resolved);
}

export function startWebSocketBridge(opts: WsBridgeOptions = {}): StartedWsBridge | undefined {
  const enabled = opts.enable ?? envEnabled();
  if (!enabled) return undefined;

  // Single-process hot-reload guard: reuse if already running to avoid double-binding the port.
  const existing = getStoredBridge();
  if (existing) return existing;

  const port = opts.port ?? (Number(process.env.REMNOTE_WS_PORT || process.env.WS_PORT) || 6789);
  const wsPath = opts.path ?? process.env.REMNOTE_WS_PATH ?? '/ws';
  const host = opts.host ?? process.env.REMNOTE_WS_HOST ?? 'localhost';
  const heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 30_000;

  const queueDbPathRaw = opts.queueDbPath ?? defaultQueuePath();
  const queueDbPathResolved = resolveUserFilePath(queueDbPathRaw);

  const stateFilePath = resolveBridgeStateFilePath({ disabled: opts.stateFileDisabled, path: opts.stateFilePath });

  const kickConfig = envKickConfig();
  const wsSchedulerEnabled = envWsSchedulerEnabled(true);
  const wsDispatchMaxBytes = envDispatchMaxBytes(512_000);
  const wsDispatchMaxOpBytes = envDispatchMaxOpBytes(256_000);
  const activeWorkerStaleMs = envActiveWorkerStaleMs(90_000);

  const buildFallback =
    typeof opts.buildDbFallbackNextAction === 'function' ? opts.buildDbFallbackNextAction : buildDbFallbackNextAction;

  let wss: WebSocketServer | undefined;
  try {
    wss = new WebSocketServer({ port, path: wsPath, host });
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (msg.includes('EADDRINUSE')) {
      console.error(`ws port already in use (${port}${wsPath}); likely due to hot reload overlap.`);
      return undefined;
    }
    console.error(`failed to start websocket bridge on port ${port}${wsPath}:`, msg);
    return undefined;
  }

  const db = (() => {
    try {
      return openQueueDb(queueDbPathResolved);
    } catch (e: any) {
      console.error(`failed to open store db (${queueDbPathResolved}):`, String(e?.message || e || 'unknown'));
      try {
        wss?.close();
      } catch {}
      return null;
    }
  })();
  if (!db) return undefined;

  const config: WsBridgeCoreConfig = {
    serverInfo: { port, path: wsPath },
    queueDbPath: queueDbPathResolved,
    stateFileEnabled: !!stateFilePath,
    stateWriteMinIntervalMs: 250,
    activeWorkerStaleMs,
    noActiveWorkerWarnCooldownMs: 60_000,
    kickConfig,
    wsSchedulerEnabled,
    wsDispatchMaxBytes,
    wsDispatchMaxOpBytes,
    buildDbFallbackNextAction: buildFallback,
  };

  const core = makeWsBridgeCore({ config, db });

  const sockets = new Map<string, WebSocket & { isAlive?: boolean }>();
  const connIdBySocket = new Map<WebSocket, string>();
  const timers = new Map<string, NodeJS.Timeout>();

  const sendJson = (connId: string, msg: unknown): boolean => {
    const ws = sockets.get(connId);
    if (!ws) return false;
    if ((ws as any).readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  };

  const applyActions = (actions: readonly WsBridgeCoreAction[]) => {
    for (const action of actions) {
      if (action._tag === 'SendJson') {
        void sendJson(action.connId, action.msg);
        continue;
      }
      if (action._tag === 'SendJsonWithResult') {
        const ok = sendJson(action.connId, action.msg);
        applyActions(action.onResult(ok));
        continue;
      }
      if (action._tag === 'Terminate') {
        const ws = sockets.get(action.connId);
        if (ws) {
          try {
            ws.terminate();
          } catch {}
        }
        continue;
      }
      if (action._tag === 'HeartbeatSweep') {
        wss?.clients.forEach((ws) => {
          const sock = ws as WebSocket & { isAlive?: boolean };
          if (sock.isAlive === false) {
            try {
              ws.terminate();
            } catch {}
            return;
          }
          sock.isAlive = false;
          try {
            ws.ping();
          } catch {}
        });
        continue;
      }
      if (action._tag === 'SetTimer') {
        const existing = timers.get(action.id);
        if (existing) {
          clearTimeout(existing);
          timers.delete(action.id);
        }
        const timer = setTimeout(
          () => {
            timers.delete(action.id);
            try {
              applyActions(core.handle({ _tag: 'Timer', now: Date.now(), event: action.event }));
            } catch {}
          },
          Math.max(0, Math.floor(action.delayMs)),
        );
        timers.set(action.id, timer);
        continue;
      }
      if (action._tag === 'ClearTimer') {
        const timer = timers.get(action.id);
        if (timer) {
          clearTimeout(timer);
          timers.delete(action.id);
        }
        continue;
      }
      if (action._tag === 'WriteState') {
        if (stateFilePath) {
          try {
            writeJsonAtomic(stateFilePath, action.snapshot);
          } catch {}
        }
        continue;
      }
      if (action._tag === 'InvalidateStatusLine') {
        requestTmuxStatusLineRefresh('coalesced');
        continue;
      }
      if (action._tag === 'Log') {
        try {
          wsLog(action.level, action.event, action.details);
        } catch {}
        continue;
      }
    }
  };

  wss.on('error', (e: any) => {
    console.error(`websocket bridge error (${host}:${port}${wsPath}):`, String(e?.message || e || 'unknown'));
  });

  wss.on('listening', () => {
    let resolvedPort = port;
    try {
      const addr = (wss as any).address?.();
      if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
        resolvedPort = addr.port;
      }
    } catch {}
    applyActions(
      core.handle({ _tag: 'ServerInfoUpdated', now: Date.now(), serverInfo: { port: resolvedPort, path: wsPath } }),
    );
    console.log(`websocket bridge ready at ws://${host}:${resolvedPort}${wsPath}`);
  });

  wss.on('connection', (ws, req) => {
    const connId = randomUUID();
    const sock = ws as WebSocket & { isAlive?: boolean };
    sock.isAlive = true;
    (ws as any).isAlive = true;

    sockets.set(connId, sock);
    connIdBySocket.set(ws, connId);

    const remoteAddr = req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] as string | undefined;
    applyActions(core.handle({ _tag: 'Connected', now: Date.now(), connId, remoteAddr, userAgent }));

    ws.on('pong', () => {
      sock.isAlive = true;
      applyActions(core.handle({ _tag: 'Pong', now: Date.now(), connId }));
    });

    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : ((raw as any)?.toString?.() ?? String(raw));
      if (text === 'ping') {
        try {
          ws.send('pong');
        } catch {}
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      applyActions(core.handle({ _tag: 'MessageJson', now: Date.now(), connId, msg: parsed }));
    });

    ws.on('close', () => {
      sockets.delete(connId);
      connIdBySocket.delete(ws);
      applyActions(core.handle({ _tag: 'Disconnected', now: Date.now(), connId }));
    });

    ws.on('error', () => {
      // Ignore, close event will fire (or the heartbeat sweep will terminate).
    });
  });

  const heartbeatTimer = setInterval(() => {
    try {
      applyActions(core.handle({ _tag: 'HeartbeatTick', now: Date.now() }));
    } catch {}
  }, heartbeatIntervalMs);

  const kickTimer =
    kickConfig.enabled && kickConfig.intervalMs > 0
      ? setInterval(() => {
          try {
            applyActions(core.handle({ _tag: 'KickTick', now: Date.now() }));
          } catch {}
        }, kickConfig.intervalMs)
      : null;

  let closed = false;
  const started: StartedWsBridge = {
    wss,
    close: async () => {
      if (closed) return;
      closed = true;

      clearInterval(heartbeatTimer);
      if (kickTimer) clearInterval(kickTimer);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();

      try {
        for (const ws of wss.clients.values()) {
          try {
            ws.terminate();
          } catch {}
        }
      } catch {}

      await new Promise<void>((resolve) => wss.close(() => resolve()));

      try {
        db.close();
      } catch {}

      if (globalAny[GLOBAL_BRIDGE_KEY] === started) {
        setStoredBridge(undefined);
      }
    },
  };

  setStoredBridge(started);

  const onExit = async () => {
    try {
      await started.close();
    } catch {}
  };
  try {
    process.once('SIGINT', onExit);
    process.once('SIGTERM', onExit);
    process.once('exit', onExit);
  } catch {}

  return started;
}
