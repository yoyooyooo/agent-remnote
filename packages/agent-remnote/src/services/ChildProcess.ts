import * as Context from 'effect/Context';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import type * as Scope from 'effect/Scope';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type ChildOutcome =
  | { readonly _tag: 'Exit'; readonly code: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly _tag: 'Error'; readonly error: Error };

export type ChildHandle = {
  readonly pid: number | null;
  readonly wait: Effect.Effect<ChildOutcome, never>;
  readonly kill: (signal: NodeJS.Signals) => Effect.Effect<void>;
};

export interface ChildProcessService {
  readonly spawnPiped: (params: {
    readonly command: string;
    readonly args: readonly string[];
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly onStdout?: ((chunk: Buffer) => void) | undefined;
    readonly onStderr?: ((chunk: Buffer) => void) | undefined;
  }) => Effect.Effect<ChildHandle, never, Scope.Scope>;
}

export class ChildProcess extends Context.Tag('ChildProcess')<ChildProcess, ChildProcessService>() {}

type ChildState = {
  readonly child?: ChildProcessWithoutNullStreams | undefined;
  readonly done: { value: boolean };
  readonly outcome: Deferred.Deferred<ChildOutcome, never>;
  readonly cleanup: () => void;
};

function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  return new Error(String((e as any)?.message || e || 'Unknown error'));
}

function unsafeKill(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
  try {
    child.kill(signal);
  } catch {}
}

const GRACEFUL_STOP_MS = 5000;

export const ChildProcessLive = Layer.succeed(ChildProcess, {
  spawnPiped: ({ command, args, env, onStdout, onStderr }) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const done = { value: false };
        const outcome = yield* Deferred.make<ChildOutcome, never>();

        const finish = (out: ChildOutcome) => {
          if (done.value) return;
          done.value = true;
          Deferred.unsafeDone(outcome, Exit.succeed(out));
        };

        let child: ChildProcessWithoutNullStreams | undefined;
        try {
          child = spawn(command, [...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (e) {
          finish({ _tag: 'Error', error: asError(e) });
        }

        if (!child) {
          return { child: undefined, done, outcome, cleanup: () => {} } satisfies ChildState;
        }

        child.stdin.end();

        const onOut = (d: any) => onStdout?.(Buffer.isBuffer(d) ? d : Buffer.from(String(d)));
        const onErr = (d: any) => onStderr?.(Buffer.isBuffer(d) ? d : Buffer.from(String(d)));
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish({ _tag: 'Exit', code, signal });
        const onError = (e: Error) => finish({ _tag: 'Error', error: asError(e) });

        child.stdout.on('data', onOut);
        child.stderr.on('data', onErr);
        child.once('exit', onExit);
        child.once('error', onError);

        const cleanup = () => {
          child.stdout.off('data', onOut);
          child.stderr.off('data', onErr);
          child.off('exit', onExit);
          child.off('error', onError);
        };

        return { child, done, outcome, cleanup } satisfies ChildState;
      }),
      (state) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const safeCleanup = () => {
              try {
                state.cleanup();
              } catch {}
            };

            const child = state.child;
            if (!child) {
              yield* Effect.sync(safeCleanup);
              return;
            }

            if (state.done.value) {
              yield* Effect.sync(safeCleanup);
              return;
            }

            yield* Effect.sync(() => unsafeKill(child, 'SIGTERM'));

            const term = yield* restore(Deferred.await(state.outcome)).pipe(Effect.timeoutOption(GRACEFUL_STOP_MS));
            if (Option.isSome(term)) {
              yield* Effect.sync(safeCleanup);
              return;
            }

            yield* Effect.sync(() => unsafeKill(child, 'SIGKILL'));
            yield* restore(Deferred.await(state.outcome)).pipe(Effect.timeoutOption(GRACEFUL_STOP_MS), Effect.ignore);

            yield* Effect.sync(safeCleanup);
          }),
        ),
    ).pipe(
      Effect.map(
        (state): ChildHandle => ({
          pid: state.child?.pid ?? null,
          wait: Deferred.await(state.outcome),
          kill: (signal) =>
            Effect.sync(() => {
              if (!state.child) return;
              unsafeKill(state.child, signal);
            }),
        }),
      ),
    ),
} satisfies ChildProcessService);
