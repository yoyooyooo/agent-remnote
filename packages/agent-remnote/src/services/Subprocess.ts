import * as Context from 'effect/Context';
import * as Deferred from 'effect/Deferred';
import * as Duration from 'effect/Duration';
import * as Either from 'effect/Either';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { CliError } from './Errors.js';

export type SubprocessRunResult = {
  readonly pid?: number | undefined;
  readonly exitCode: number;
  readonly signal?: NodeJS.Signals | null | undefined;
  readonly stdout: string;
  readonly stderr: string;
};

export type SubprocessInheritResult = {
  readonly pid?: number | undefined;
  readonly exitCode: number;
  readonly signal?: NodeJS.Signals | null | undefined;
};

export interface SubprocessService {
  readonly run: (params: {
    readonly command: string;
    readonly args: readonly string[];
    readonly timeoutMs: number;
    readonly cwd?: string | undefined;
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly killSignal?: NodeJS.Signals | undefined;
  }) => Effect.Effect<SubprocessRunResult, CliError>;
  readonly runInherit: (params: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd?: string | undefined;
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly killSignal?: NodeJS.Signals | undefined;
  }) => Effect.Effect<SubprocessInheritResult, CliError>;
}

export class Subprocess extends Context.Tag('Subprocess')<Subprocess, SubprocessService>() {}

type SubprocessState = {
  readonly command: string;
  readonly args: readonly string[];
  readonly killSignal: NodeJS.Signals;
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdout: { text: string };
  readonly stderr: { text: string };
  readonly done: { value: boolean };
  readonly exit: Deferred.Deferred<SubprocessRunResult, CliError>;
  readonly cleanup: () => void;
};

type SubprocessInheritState = {
  readonly command: string;
  readonly args: readonly string[];
  readonly killSignal: NodeJS.Signals;
  readonly child: ChildProcess;
  readonly done: { value: boolean };
  readonly exit: Deferred.Deferred<SubprocessInheritResult, CliError>;
  readonly cleanup: () => void;
};

function sanitizeTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return 1;
  return Math.floor(timeoutMs);
}

function spawnCliError(command: string, args: readonly string[], error: unknown): CliError {
  const anyError = error as any;
  if (anyError?.code === 'ENOENT') {
    return new CliError({
      code: 'DEPENDENCY_MISSING',
      message: `${command} not found (install it and ensure it is on PATH)`,
      exitCode: 1,
      details: { command, args },
    });
  }
  return new CliError({
    code: 'INTERNAL',
    message: 'Failed to start child process',
    exitCode: 1,
    details: { command, args, error: String(anyError?.message || error) },
  });
}

function timeoutCliError(params: {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly pid?: number | undefined;
  readonly killSignal: NodeJS.Signals;
  readonly stdout: string;
  readonly stderr: string;
}): CliError {
  return new CliError({
    code: 'TIMEOUT',
    message: `${params.command} timed out (${params.timeoutMs}ms)`,
    exitCode: 1,
    details: {
      command: params.command,
      args: params.args,
      timeout_ms: params.timeoutMs,
      pid: params.pid,
      kill_signal: params.killSignal,
      stdout: params.stdout.trim(),
      stderr: params.stderr.trim(),
    },
  });
}

function unsafeKill(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
  try {
    child.kill(signal);
  } catch {}
}

function unsafeKillAny(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    child.kill(signal);
  } catch {}
}

function drainReadable(stream: NodeJS.ReadableStream | null | undefined): string {
  if (!stream || typeof (stream as any).read !== 'function') return '';
  let out = '';
  while (true) {
    const chunk = (stream as any).read();
    if (chunk === null) break;
    out += String(chunk);
  }
  return out;
}

export const SubprocessLive = Layer.succeed(Subprocess, {
  run: ({ command, args, timeoutMs, cwd, env, killSignal }) =>
    Effect.scoped(
      Effect.acquireRelease(
        Effect.gen(function* () {
          const stdout = { text: '' };
          const stderr = { text: '' };
          const done = { value: false };
          const exit = yield* Deferred.make<SubprocessRunResult, CliError>();

          const child = yield* Effect.try({
            try: () =>
              spawn(command, [...args], {
                cwd,
                env,
                stdio: 'pipe',
              }),
            catch: (error) => spawnCliError(command, args, error),
          });

          child.stdout.setEncoding('utf8');
          child.stderr.setEncoding('utf8');

          const finish = (ex: Exit.Exit<SubprocessRunResult, CliError>) => {
            if (done.value) return;
            done.value = true;
            Deferred.unsafeDone(exit, ex);
          };

          const onStdout = (data: any) => {
            stdout.text += String(data);
          };
          const onStderr = (data: any) => {
            stderr.text += String(data);
          };
          const onError = (error: unknown) => {
            finish(Exit.fail(spawnCliError(command, args, error)));
          };
          const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
            finish(
              Exit.succeed({
                pid: child.pid,
                exitCode: typeof code === 'number' ? code : 1,
                signal,
                stdout: stdout.text,
                stderr: stderr.text,
              }),
            );
          };

          child.stdout.on('data', onStdout);
          child.stderr.on('data', onStderr);
          child.once('error', onError);
          child.once('close', onClose);

          const cleanup = () => {
            child.stdout.off('data', onStdout);
            child.stderr.off('data', onStderr);
            child.off('error', onError);
            child.off('close', onClose);
          };

          return {
            command,
            args,
            killSignal: killSignal ?? 'SIGKILL',
            child,
            stdout,
            stderr,
            done,
            exit,
            cleanup,
          } satisfies SubprocessState;
        }),
        (state) =>
          Effect.gen(function* () {
            if (!state.done.value) {
              yield* Effect.sync(() => unsafeKill(state.child, state.killSignal));
            }
            yield* Effect.sync(state.cleanup);
          }),
      ).pipe(
        Effect.flatMap((state) =>
          Deferred.await(state.exit).pipe(
            Effect.timeoutTo({
              duration: sanitizeTimeoutMs(timeoutMs),
              onSuccess: (result) => Either.right(result),
              onTimeout: () => Either.left(undefined),
            }),
            Effect.flatMap((result) =>
              Either.isRight(result)
                ? Effect.succeed(result.right)
                : Effect.gen(function* () {
                    yield* Effect.sync(() => unsafeKill(state.child, state.killSignal));
                    yield* Effect.sleep(Duration.millis(50));
                    yield* Effect.sync(() => {
                      state.stdout.text += drainReadable(state.child.stdout);
                      state.stderr.text += drainReadable(state.child.stderr);
                    });
                    return yield* Effect.fail(
                      timeoutCliError({
                        command,
                        args,
                        timeoutMs: sanitizeTimeoutMs(timeoutMs),
                        pid: state.child.pid,
                        killSignal: state.killSignal,
                        stdout: state.stdout.text,
                        stderr: state.stderr.text,
                      }),
                    );
                  }),
            ),
          ),
        ),
      ),
    ),
  runInherit: ({ command, args, cwd, env, killSignal }) =>
    Effect.scoped(
      Effect.acquireRelease(
        Effect.gen(function* () {
          const done = { value: false };
          const exit = yield* Deferred.make<SubprocessInheritResult, CliError>();

          const child = yield* Effect.try({
            try: () =>
              spawn(command, [...args], {
                cwd,
                env,
                stdio: 'inherit',
              }),
            catch: (error) => spawnCliError(command, args, error),
          });

          const finish = (ex: Exit.Exit<SubprocessInheritResult, CliError>) => {
            if (done.value) return;
            done.value = true;
            Deferred.unsafeDone(exit, ex);
          };

          const onError = (error: unknown) => {
            finish(Exit.fail(spawnCliError(command, args, error)));
          };
          const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
            finish(
              Exit.succeed({
                pid: child.pid,
                exitCode: typeof code === 'number' ? code : 1,
                signal,
              }),
            );
          };

          child.once('error', onError);
          child.once('close', onClose);

          const cleanup = () => {
            child.off('error', onError);
            child.off('close', onClose);
          };

          return {
            command,
            args,
            killSignal: killSignal ?? 'SIGKILL',
            child,
            done,
            exit,
            cleanup,
          } satisfies SubprocessInheritState;
        }),
        (state) =>
          Effect.gen(function* () {
            if (!state.done.value) {
              yield* Effect.sync(() => unsafeKillAny(state.child, state.killSignal));
            }
            yield* Effect.sync(state.cleanup);
          }),
      ).pipe(Effect.flatMap((state) => Deferred.await(state.exit))),
    ),
} satisfies SubprocessService);
