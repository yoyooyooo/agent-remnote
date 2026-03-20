import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Queue from 'effect/Queue';

import { initialSupervisorState, planRestart } from '../../kernel/supervisor/restartPlan.js';
import type {
  SupervisorLastExit,
  SupervisorRestartConfig,
  SupervisorStateFile,
} from '../../kernel/supervisor/model.js';

import { AppConfig } from '../../services/AppConfig.js';
import { ChildProcess, type ChildOutcome } from '../../services/ChildProcess.js';
import { DaemonFiles, type WsPidFile } from '../../services/DaemonFiles.js';
import { LogWriterFactory } from '../../services/LogWriter.js';
import type { CliError } from '../../services/Errors.js';
import { SupervisorState } from '../../services/SupervisorState.js';
import { currentRuntimeBuildInfo } from '../../lib/runtimeBuildInfo.js';

type SupervisorEvent =
  | { readonly _tag: 'ChildSpawned'; readonly pid: number | null; readonly startedAt: number }
  | { readonly _tag: 'ChildOutcome'; readonly outcome: ChildOutcome; readonly at: number }
  | { readonly _tag: 'RestartDue' }
  | { readonly _tag: 'Stop'; readonly signal: NodeJS.Signals };

type RuntimeState = {
  supervisorStartedAt: number;
  childPid: number | null;
  childStartedAt: number | null;
  supervisorState: SupervisorStateFile;
  stopping: boolean;
  childFiber: Fiber.RuntimeFiber<void, never> | null;
  restartFiber: Fiber.RuntimeFiber<void, never> | null;
};

function normalizeExit(outcome: ChildOutcome, at: number): SupervisorLastExit {
  if (outcome._tag === 'Exit') {
    const reason = outcome.signal ? `signal:${outcome.signal}` : outcome.code === 0 ? 'exit:0' : 'exit:nonzero';
    return { at, code: outcome.code, signal: outcome.signal, reason };
  }
  return { at, code: null, signal: null, reason: `spawn_failed:${outcome.error.message}` };
}

function updateRunningState(prev: SupervisorStateFile): SupervisorStateFile {
  return { ...prev, status: 'running', backoff_until: null, failed_reason: null };
}

function makePidFileValue(params: {
  readonly supervisorPid: number;
  readonly supervisorStartedAt: number;
  readonly wsUrl: string;
  readonly logFilePath: string;
  readonly stateFilePath: string;
  readonly wsBridgeStateFilePath: string;
  readonly statusLineFilePath: string;
  readonly statusLineJsonFilePath: string;
  readonly queueDbPath: string;
  readonly childPid: number | null;
  readonly childStartedAt: number | null;
}): WsPidFile {
  return {
    mode: 'supervisor',
    pid: params.supervisorPid,
    build: currentRuntimeBuildInfo(),
    child_pid: params.childPid,
    child_started_at: params.childStartedAt,
    started_at: params.supervisorStartedAt,
    ws_url: params.wsUrl,
    log_file: params.logFilePath,
    queue_db: params.queueDbPath,
    state_file: params.stateFilePath,
    ws_bridge_state_file: params.wsBridgeStateFilePath,
    status_line_file: params.statusLineFilePath,
    status_line_json_file: params.statusLineJsonFilePath,
    cmd: process.argv,
  };
}

export function runSupervisorRuntime(params: {
  readonly pidFilePath: string;
  readonly logFilePath: string;
  readonly stateFilePath: string;
  readonly logWriter: { readonly maxBytes: number; readonly keep: number };
  readonly restart: SupervisorRestartConfig;
  readonly child: {
    readonly command: string;
    readonly args: readonly string[];
    readonly env?: NodeJS.ProcessEnv | undefined;
  };
}): Effect.Effect<void, CliError, AppConfig | ChildProcess | DaemonFiles | SupervisorState | LogWriterFactory> {
  return Effect.scoped(
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const daemonFiles = yield* DaemonFiles;
      const supervisorStateSvc = yield* SupervisorState;
      const childProc = yield* ChildProcess;
      const logFactory = yield* LogWriterFactory;

      const logWriter = yield* logFactory.open({ filePath: params.logFilePath, options: params.logWriter });

      const events = yield* Queue.unbounded<SupervisorEvent>();

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const onTerm = () => Queue.unsafeOffer(events, { _tag: 'Stop', signal: 'SIGTERM' });
          const onInt = () => Queue.unsafeOffer(events, { _tag: 'Stop', signal: 'SIGINT' });
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

      const supervisorStartedAt = yield* Clock.currentTimeMillis;

      let state: RuntimeState = {
        supervisorStartedAt,
        childPid: null,
        childStartedAt: null,
        supervisorState: initialSupervisorState(supervisorStartedAt),
        stopping: false,
        childFiber: null,
        restartFiber: null,
      };

      const writePidFile = (childPid: number | null, childStartedAt: number | null) =>
        daemonFiles.writePidFile(
          params.pidFilePath,
          makePidFileValue({
            supervisorPid: process.pid,
            supervisorStartedAt: state.supervisorStartedAt,
            wsUrl: cfg.wsUrl,
            logFilePath: params.logFilePath,
            stateFilePath: params.stateFilePath,
            wsBridgeStateFilePath: cfg.wsStateFile.path,
            statusLineFilePath: cfg.statusLineFile,
            statusLineJsonFilePath: cfg.statusLineJsonFile,
            queueDbPath: cfg.storeDb,
            childPid,
            childStartedAt,
          }),
        );

      const writeStateFile = (next: SupervisorStateFile) =>
        supervisorStateSvc.writeStateFile(params.stateFilePath, next).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              state = { ...state, supervisorState: next };
            }),
          ),
        );

      const cancelRestart = Effect.gen(function* () {
        if (state.restartFiber) {
          yield* Fiber.interrupt(state.restartFiber);
          state = { ...state, restartFiber: null };
        }
      });

      const stopChildFiber = Effect.gen(function* () {
        if (state.childFiber) {
          yield* Fiber.interrupt(state.childFiber);
          state = { ...state, childFiber: null };
        }
      });

      const startChild = Effect.gen(function* () {
        yield* cancelRestart;
        if (state.stopping) return;

        const fiber = yield* Effect.forkScoped(
          Effect.scoped(
            Effect.gen(function* () {
              const startedAt = yield* Clock.currentTimeMillis;
              const handle = yield* childProc.spawnPiped({
                command: params.child.command,
                args: params.child.args,
                env: params.child.env,
                onStdout: (d) => logWriter.write(d),
                onStderr: (d) => logWriter.write(d),
              });
              Queue.unsafeOffer(events, { _tag: 'ChildSpawned', pid: handle.pid, startedAt });
              const outcome = yield* handle.wait;
              const at = yield* Clock.currentTimeMillis;
              Queue.unsafeOffer(events, { _tag: 'ChildOutcome', outcome, at });
            }),
          ),
        );

        state = { ...state, childFiber: fiber };
      });

      const scheduleRestart = (delayMs: number) =>
        Effect.gen(function* () {
          yield* cancelRestart;
          if (state.stopping) return;
          const fiber = yield* Effect.forkScoped(
            Effect.sleep(delayMs).pipe(
              Effect.zipRight(
                Effect.sync(() => {
                  Queue.unsafeOffer(events, { _tag: 'RestartDue' });
                }),
              ),
            ),
          );
          state = { ...state, restartFiber: fiber };
        });

      // Boot: write pid/state + start the first child.
      yield* writePidFile(null, null);
      yield* writeStateFile(state.supervisorState);
      yield* startChild;

      while (true) {
        const ev = yield* Queue.take(events);
        switch (ev._tag) {
          case 'ChildSpawned': {
            state = { ...state, childPid: ev.pid, childStartedAt: ev.startedAt };
            yield* writePidFile(ev.pid, ev.startedAt);
            yield* writeStateFile(updateRunningState(state.supervisorState));
            break;
          }
          case 'ChildOutcome': {
            state = { ...state, childPid: null, childStartedAt: null, childFiber: null };
            yield* writePidFile(null, null);

            if (state.stopping) {
              return;
            }

            const lastExit = normalizeExit(ev.outcome, ev.at);
            const planned = planRestart({ now: ev.at, state: state.supervisorState, lastExit, config: params.restart });
            yield* writeStateFile(planned.nextState);

            if (planned._tag === 'restart') {
              yield* scheduleRestart(planned.delayMs);
            } else {
              yield* cancelRestart;
            }

            break;
          }
          case 'RestartDue': {
            if (state.stopping) break;
            if (state.supervisorState.status === 'failed') break;
            yield* startChild;
            break;
          }
          case 'Stop': {
            if (state.stopping) break;
            state = { ...state, stopping: true };
            yield* cancelRestart;
            yield* writeStateFile({ ...state.supervisorState, status: 'stopping', backoff_until: null });
            yield* stopChildFiber;
            state = { ...state, childPid: null, childStartedAt: null };
            yield* writePidFile(null, null);
            return;
          }
        }
      }
    }),
  );
}
