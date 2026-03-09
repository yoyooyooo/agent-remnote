import { describe, expect, it } from 'vitest';

import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';

import { Subprocess, SubprocessLive } from '../../src/services/Subprocess.js';

function unwrapCliError(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) throw new Error('Expected failure exit');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected failure cause');
  return failure.value as any;
}

function isPidRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

describe('Subprocess (unit)', () => {
  it('kills on timeout and includes output diagnostics', async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const sp = yield* Subprocess;
        return yield* sp
          .run({
            command: 'node',
            args: ['-e', "require('node:fs').writeSync(2, 'ERR\\n'); setTimeout(() => {}, 60_000)"],
            timeoutMs: 1000,
          })
          .pipe(Effect.exit);
      }).pipe(Effect.provide(SubprocessLive)),
    );

    const error = unwrapCliError(exit);
    expect(error).toMatchObject({ _tag: 'CliError', code: 'TIMEOUT', exitCode: 1 });
    expect(String((error as any)?.details?.stderr || '')).toContain('ERR');

    const pid = Number((error as any)?.details?.pid ?? 0);
    if (Number.isFinite(pid) && pid > 0) {
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline && isPidRunning(pid)) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(isPidRunning(pid)).toBe(false);
    }
  });

  it('returns exitCode and captures stdout/stderr', async () => {
    const res = await Effect.runPromise(
      Effect.gen(function* () {
        const sp = yield* Subprocess;
        return yield* sp.run({
          command: 'node',
          args: ['-e', "console.log('OUT'); console.error('ERR'); process.exit(3)"],
          timeoutMs: 5000,
        });
      }).pipe(Effect.provide(SubprocessLive)),
    );

    expect(res.exitCode).toBe(3);
    expect(res.stdout).toContain('OUT');
    expect(res.stderr).toContain('ERR');
  });
});
