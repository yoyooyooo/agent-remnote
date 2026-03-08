import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Queue from 'effect/Queue';
import type * as Scope from 'effect/Scope';
import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

import { CliError } from './Errors.js';

export type WsBridgeServerEvent =
  | {
      readonly _tag: 'Connected';
      readonly connId: string;
      readonly remoteAddr?: string | undefined;
      readonly userAgent?: string | undefined;
    }
  | { readonly _tag: 'Disconnected'; readonly connId: string }
  | { readonly _tag: 'Pong'; readonly connId: string }
  | { readonly _tag: 'Message'; readonly connId: string; readonly text: string }
  | { readonly _tag: 'MessageJson'; readonly connId: string; readonly text: string; readonly msg: unknown };

export type WsBridgeServerHandle = {
  readonly events: Queue.Queue<WsBridgeServerEvent>;
  readonly serverInfo: { readonly port: number; readonly path: string };
  readonly sendText: (connId: string, text: string) => Effect.Effect<boolean>;
  readonly sendJson: (connId: string, msg: unknown) => Effect.Effect<boolean>;
  readonly heartbeatSweep: () => Effect.Effect<void>;
  readonly terminate: (connId: string) => Effect.Effect<void>;
};

export interface WsBridgeServerService {
  readonly listen: (params: {
    readonly port: number;
    readonly path: string;
    readonly host?: string | undefined;
  }) => Effect.Effect<WsBridgeServerHandle, CliError, Scope.Scope>;
}

export class WsBridgeServer extends Context.Tag('WsBridgeServer')<WsBridgeServer, WsBridgeServerService>() {}

function safeStringHeader(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s ? s : undefined;
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const WsBridgeServerLive = Layer.succeed(WsBridgeServer, {
  listen: ({ port, path, host }) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const events = yield* Queue.unbounded<WsBridgeServerEvent>();
        const sockets = new Map<string, WebSocket & { isAlive?: boolean }>();
        const wss = new WebSocketServer({ port, host, path });

        wss.on('connection', (ws: any, req: any) => {
          const connId = randomUUID();
          const remoteAddr = safeStringHeader((req as any)?.socket?.remoteAddress);
          const userAgent = safeStringHeader((req as any)?.headers?.['user-agent']);

          sockets.set(connId, ws);
          ws.isAlive = true;

          Queue.unsafeOffer(events, { _tag: 'Connected', connId, remoteAddr, userAgent });

          ws.on('pong', () => {
            ws.isAlive = true;
            Queue.unsafeOffer(events, { _tag: 'Pong', connId });
          });

          ws.on('message', (raw: any) => {
            const text = typeof raw === 'string' ? raw : (raw?.toString?.() ?? String(raw));
            if (text === 'ping') {
              try {
                ws.send('pong');
              } catch {}
              return;
            }

            const parsed = safeJsonParse(text);
            if (parsed !== null) Queue.unsafeOffer(events, { _tag: 'MessageJson', connId, text, msg: parsed });
            else Queue.unsafeOffer(events, { _tag: 'Message', connId, text });
          });

          ws.on('close', () => {
            sockets.delete(connId);
            Queue.unsafeOffer(events, { _tag: 'Disconnected', connId });
          });

          ws.on('error', () => {
            // Ignore, close event will fire (or the heartbeat sweep will terminate).
          });
        });

        const handle: WsBridgeServerHandle = {
          events,
          serverInfo: { port, path },
          sendText: (connId, text) =>
            Effect.sync(() => {
              const ws = sockets.get(connId);
              if (!ws) return false;
              if ((ws as any).readyState !== 1) return false; // WebSocket.OPEN
              try {
                ws.send(text);
                return true;
              } catch {
                return false;
              }
            }),
          sendJson: (connId, msg) =>
            Effect.sync(() => {
              const ws = sockets.get(connId);
              if (!ws) return false;
              if ((ws as any).readyState !== 1) return false; // WebSocket.OPEN
              try {
                ws.send(JSON.stringify(msg));
                return true;
              } catch {
                return false;
              }
            }),
          heartbeatSweep: () =>
            Effect.sync(() => {
              for (const ws of sockets.values()) {
                if (ws.isAlive === false) {
                  try {
                    ws.terminate();
                  } catch {}
                  continue;
                }
                ws.isAlive = false;
                try {
                  ws.ping();
                } catch {}
              }
            }),
          terminate: (connId) =>
            Effect.sync(() => {
              const ws = sockets.get(connId);
              if (!ws) return;
              try {
                ws.terminate();
              } catch {}
            }),
        };

        return { handle, wss, events };
      }),
      ({ wss, events }) =>
        Effect.gen(function* () {
          yield* Queue.shutdown(events);
          yield* Effect.sync(() => {
            try {
              wss.close();
            } catch {}
          });
        }),
    ).pipe(
      Effect.map(({ handle }) => handle),
      Effect.catchAll((error) =>
        Effect.fail(
          new CliError({
            code: 'WS_UNAVAILABLE',
            message: 'Failed to start ws bridge server',
            exitCode: 1,
            details: { error: String((error as any)?.message || error), port, path, host },
          }),
        ),
      ),
    ),
} satisfies WsBridgeServerService);
