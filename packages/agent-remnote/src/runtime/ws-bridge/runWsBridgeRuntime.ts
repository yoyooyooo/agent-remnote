import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Queue from 'effect/Queue';
import * as Schedule from 'effect/Schedule';
import * as Scope from 'effect/Scope';

import type { WsBridgeKickConfig } from '../../kernel/ws-bridge/index.js';
import { makeWsBridgeCore, type WsBridgeCoreAction, type WsBridgeCoreTimerEvent } from '../../internal/ws-bridge/index.js';

import { openQueueDb, QueueSchemaError } from '../../internal/queue/index.js';

import { AppConfig } from '../../services/AppConfig.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { buildDbFallbackNextAction } from '../../services/WsBridgeNextActions.js';
import type { StatusLineFile } from '../../services/StatusLineFile.js';
import { WsBridgeServer, type WsBridgeServerEvent } from '../../services/WsBridgeServer.js';
import { WsBridgeStateFile } from '../../services/WsBridgeStateFile.js';

import { wsLog } from '../../lib/wsDebug.js';
import { cleanupStatuslineArtifacts, resolveStatuslineArtifactPaths } from '../../lib/statuslineArtifacts.js';
import { refreshTmuxStatusLine } from '../../lib/tmux.js';
import { StatusLineController } from '../status-line/StatusLineController.js';

type BridgeEvent =
  | { readonly _tag: 'Server'; readonly event: WsBridgeServerEvent }
  | { readonly _tag: 'HeartbeatTick' }
  | { readonly _tag: 'KickTick' }
  | { readonly _tag: 'Timer'; readonly event: WsBridgeCoreTimerEvent }
  | { readonly _tag: 'Stop'; readonly signal: NodeJS.Signals };

const DEFAULT_ACTIVE_WORKER_STALE_MS = 90_000;
const STATE_FILE_MIN_INTERVAL_MS = 250;
const NO_ACTIVE_WORKER_WARN_COOLDOWN_MS = 60_000;

const DEFAULT_KICK_CONFIG: WsBridgeKickConfig = {
  enabled: true,
  intervalMs: 30_000,
  cooldownMs: 15_000,
  noProgressWarnMs: 30_000,
  noProgressEscalateMs: 90_000,
};

export function runWsBridgeRuntime(params: {
  readonly port: number;
  readonly path: string;
  readonly host?: string | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly kickConfig?: WsBridgeKickConfig | undefined;
}): Effect.Effect<void, CliError, AppConfig | StatusLineFile | WsBridgeServer | WsBridgeStateFile | StatusLineController> {
  return Effect.scoped(
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const wsServer = yield* WsBridgeServer;
      const stateFile = yield* WsBridgeStateFile;
      const statusLine = yield* StatusLineController;

      const server = yield* wsServer.listen({ port: params.port, path: params.path, host: params.host ?? 'localhost' });

      const db = yield* Effect.acquireRelease(
        Effect.try({
          try: () => openQueueDb(cfg.storeDb),
          catch: (e) =>
            isCliError(e)
              ? e
              : e instanceof QueueSchemaError
                ? new CliError({
                    code: e.code,
                    message: e.message,
                    exitCode: 1,
                    details: { store_db: cfg.storeDb, ...(e.details || {}) },
                    hint: Array.isArray(e.nextActions) ? e.nextActions : undefined,
                  })
                : new CliError({
                    code: 'DB_UNAVAILABLE',
                    message: 'Failed to open store db',
                    exitCode: 1,
                    details: { store_db: cfg.storeDb, error: String((e as any)?.message || e) },
                  }),
        }),
        (db) =>
          Effect.sync(() => {
            try {
              db.close();
            } catch {}
          }),
      );

      const kickConfig = params.kickConfig ?? DEFAULT_KICK_CONFIG;
      const heartbeatIntervalMs = params.heartbeatIntervalMs ?? 30_000;

      const core = makeWsBridgeCore({
        config: {
          serverInfo: server.serverInfo,
          queueDbPath: cfg.storeDb,
          stateFileEnabled: !cfg.wsStateFile.disabled,
          stateWriteMinIntervalMs: STATE_FILE_MIN_INTERVAL_MS,
          activeWorkerStaleMs: DEFAULT_ACTIVE_WORKER_STALE_MS,
          noActiveWorkerWarnCooldownMs: NO_ACTIVE_WORKER_WARN_COOLDOWN_MS,
          kickConfig,
          wsSchedulerEnabled: cfg.wsScheduler,
          wsDispatchMaxBytes: cfg.wsDispatchMaxBytes,
          wsDispatchMaxOpBytes: cfg.wsDispatchMaxOpBytes,
          buildDbFallbackNextAction,
        },
        db,
      });

      const inbox = yield* Queue.unbounded<BridgeEvent>();
      const offer = (evt: BridgeEvent) => Queue.offer(inbox, evt).pipe(Effect.asVoid, Effect.catchAll(() => Effect.void));

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const onTerm = () => Queue.unsafeOffer(inbox, { _tag: 'Stop', signal: 'SIGTERM' });
          const onInt = () => Queue.unsafeOffer(inbox, { _tag: 'Stop', signal: 'SIGINT' });
          process.on('SIGTERM', onTerm);
          process.on('SIGINT', onInt);
          return { onTerm, onInt };
        }),
        (handlers) =>
          Effect.sync(() => {
            try {
              process.off('SIGTERM', handlers.onTerm);
              process.off('SIGINT', handlers.onInt);
            } catch {}
          }),
      ).pipe(Effect.asVoid);

      const timers = new Map<string, Fiber.RuntimeFiber<void, never>>();

      const cancelTimer = (id: string): Effect.Effect<void, never, never> =>
        Effect.gen(function* () {
          const fiber = timers.get(id);
          if (!fiber) return;
          timers.delete(id);
          yield* Fiber.interrupt(fiber).pipe(Effect.catchAll(() => Effect.void));
        });

      const scheduleTimer = (id: string, delayMs: number, event: WsBridgeCoreTimerEvent): Effect.Effect<void, never, Scope.Scope> =>
        Effect.gen(function* () {
          yield* cancelTimer(id);
          const fiber = yield* Effect.forkScoped(
            Effect.sleep(delayMs).pipe(
              Effect.zipRight(Effect.sync(() => timers.delete(id))),
              Effect.zipRight(offer({ _tag: 'Timer', event })),
            ),
          );
          timers.set(id, fiber);
        });

      const invalidateStatusLine = (reason: string) =>
        statusLine.invalidate({ source: 'daemon', reason }).pipe(Effect.catchAll(() => Effect.void));

      const runActions = (actions: readonly WsBridgeCoreAction[]): Effect.Effect<void, never, Scope.Scope> =>
        Effect.gen(function* () {
          for (const action of actions) {
            yield* runAction(action);
          }
        });

      const runAction = (action: WsBridgeCoreAction): Effect.Effect<void, never, Scope.Scope> => {
        switch (action._tag) {
          case 'SendJson':
            return server.sendJson(action.connId, action.msg).pipe(Effect.asVoid, Effect.catchAll(() => Effect.void));
          case 'SendJsonWithResult':
            return server.sendJson(action.connId, action.msg).pipe(
              Effect.catchAll(() => Effect.succeed(false)),
              Effect.flatMap((ok) => runActions(action.onResult(ok))),
            );
          case 'Terminate':
            return server.terminate(action.connId).pipe(Effect.catchAll(() => Effect.void));
          case 'HeartbeatSweep':
            return server.heartbeatSweep().pipe(Effect.catchAll(() => Effect.void));
          case 'SetTimer':
            return scheduleTimer(action.id, action.delayMs, action.event).pipe(Effect.catchAll(() => Effect.void));
          case 'ClearTimer':
            return cancelTimer(action.id).pipe(Effect.catchAll(() => Effect.void));
          case 'WriteState':
            if (cfg.wsStateFile.disabled) return Effect.void;
            return stateFile.write({ filePath: cfg.wsStateFile.path, json: action.snapshot }).pipe(Effect.catchAll(() => Effect.void));
          case 'InvalidateStatusLine':
            return invalidateStatusLine(action.reason);
          case 'Log':
            return Effect.sync(() => wsLog(action.level, action.event, action.details)).pipe(Effect.catchAll(() => Effect.void));
        }
      };

      // Forward server events into the actor inbox.
      yield* Effect.forkScoped(
        Effect.forever(Queue.take(server.events).pipe(Effect.flatMap((e) => offer({ _tag: 'Server', event: e })))),
      );

      // Heartbeat loop.
      yield* Effect.forkScoped(
        Effect.repeat(
          offer({ _tag: 'HeartbeatTick' }),
          Schedule.spaced(heartbeatIntervalMs),
        ),
      );

      // Kick loop.
      if (kickConfig.enabled && kickConfig.intervalMs > 0) {
        yield* Effect.forkScoped(Effect.repeat(offer({ _tag: 'KickTick' }), Schedule.spaced(kickConfig.intervalMs)));
      }

      // Initial snapshot (best-effort) so tools can detect the daemon quickly.
      const bootNow = yield* Clock.currentTimeMillis;
      yield* runActions(core.handle({ _tag: 'HeartbeatTick', now: bootNow }));

      while (true) {
        const evt = yield* Queue.take(inbox);
        const now = yield* Clock.currentTimeMillis;

        if (evt._tag === 'Stop') {
          const paths = resolveStatuslineArtifactPaths({ cfg });
          yield* cleanupStatuslineArtifacts(paths);
          yield* Effect.sync(() => refreshTmuxStatusLine());
          return;
        }

        if (evt._tag === 'HeartbeatTick') {
          yield* runActions(core.handle({ _tag: 'HeartbeatTick', now }));
          continue;
        }

        if (evt._tag === 'KickTick') {
          yield* runActions(core.handle({ _tag: 'KickTick', now }));
          continue;
        }

        if (evt._tag === 'Timer') {
          yield* runActions(core.handle({ _tag: 'Timer', now, event: evt.event }));
          continue;
        }

        // evt._tag === 'Server'
        const event = evt.event;
        if (event._tag === 'Connected') {
          yield* runActions(
            core.handle({ _tag: 'Connected', now, connId: event.connId, remoteAddr: event.remoteAddr, userAgent: event.userAgent }),
          );
          continue;
        }

        if (event._tag === 'Disconnected') {
          yield* runActions(core.handle({ _tag: 'Disconnected', now, connId: event.connId }));
          continue;
        }

        if (event._tag === 'Pong') {
          yield* runActions(core.handle({ _tag: 'Pong', now, connId: event.connId }));
          continue;
        }

        if (event._tag === 'Message') {
          continue;
        }

        // event._tag === 'MessageJson'
        yield* runActions(core.handle({ _tag: 'MessageJson', now, connId: event.connId, msg: event.msg }));
      }
    }),
  );
}
