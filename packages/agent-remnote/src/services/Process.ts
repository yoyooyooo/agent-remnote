import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { CliError, isCliError } from './Errors.js';

export interface ProcessService {
  readonly isPidRunning: (pid: number) => Effect.Effect<boolean>;
  readonly spawnDetached: (params: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd?: string | undefined;
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly logFile: string;
  }) => Effect.Effect<number, CliError>;
  readonly kill: (pid: number, signal: NodeJS.Signals) => Effect.Effect<void, CliError>;
  readonly waitForExit: (params: { readonly pid: number; readonly timeoutMs: number }) => Effect.Effect<boolean>;
}

export class Process extends Context.Tag('Process')<Process, ProcessService>() {}

function ensureDirSync(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export const ProcessLive = Layer.succeed(Process, {
  isPidRunning: (pid) =>
    Effect.sync(() => {
      if (!Number.isFinite(pid) || pid <= 0) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch (error: any) {
        if (error?.code === 'EPERM') return true;
        return false;
      }
    }),
  spawnDetached: (params) =>
    Effect.try({
      try: () => {
        ensureDirSync(params.logFile);
        const fd = fs.openSync(params.logFile, 'a');
        const child = spawn(params.command, [...params.args], {
          cwd: params.cwd,
          env: params.env,
          detached: true,
          stdio: ['ignore', fd, fd],
        });
        child.unref();
        return child.pid;
      },
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to start background process',
          exitCode: 1,
          details: { error: String((error as any)?.message || error) },
        });
      },
    }).pipe(
      Effect.flatMap((pid) => {
        if (typeof pid !== 'number' || !Number.isFinite(pid)) {
          return Effect.fail(
            new CliError({
              code: 'INTERNAL',
              message: 'Failed to start background process (pid is unavailable)',
              exitCode: 1,
            }),
          );
        }
        return Effect.succeed(pid);
      }),
    ),
  kill: (pid, signal) =>
    Effect.try({
      try: () => {
        process.kill(pid, signal);
      },
      catch: (error) =>
        new CliError({
          code: 'INTERNAL',
          message: `Failed to send signal (${signal})`,
          exitCode: 1,
          details: { pid, signal, error: String((error as any)?.message || error) },
        }),
    }),
  waitForExit: ({ pid, timeoutMs }) =>
    Effect.async<boolean>((resume) => {
      const deadline = Date.now() + Math.max(0, timeoutMs);
      const tick = () => {
        let alive = false;
        try {
          process.kill(pid, 0);
          alive = true;
        } catch (error: any) {
          alive = error?.code === 'EPERM';
        }
        if (!alive) {
          resume(Effect.succeed(true));
          return;
        }
        if (Date.now() >= deadline) {
          resume(Effect.succeed(false));
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    }),
} satisfies ProcessService);
