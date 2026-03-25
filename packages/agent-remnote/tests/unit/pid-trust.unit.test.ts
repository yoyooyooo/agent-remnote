import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import os from 'node:os';
import path from 'node:path';

import { isTrustedPidRecord } from '../../src/lib/pidTrust.js';
import { Process } from '../../src/services/Process.js';

function mainPath(): string {
  return path.join(os.tmpdir(), 'agent-remnote', 'src', 'main.ts');
}

function makeProcess(commandLine?: string) {
  return {
    isPidRunning: () => Effect.succeed(true),
    getCommandLine: commandLine === undefined ? undefined : () => Effect.succeed(commandLine),
    spawnDetached: () => Effect.die('unreachable'),
    kill: () => Effect.die('unreachable'),
    waitForExit: () => Effect.die('unreachable'),
  };
}

describe('pid trust (unit)', () => {
  it('requires service-specific tokens to match the live command line', async () => {
    const trusted = await Effect.runPromise(
      isTrustedPidRecord({
        pid: 123,
        cmd: [process.execPath, '--import', 'tsx', mainPath(), 'api', 'serve'],
      }).pipe(
        Effect.provideService(
          Process,
          makeProcess(`${process.execPath} --import tsx ${mainPath()} daemon serve`) as any,
        ),
      ),
    );

    expect(trusted).toBe(false);
  });

  it('fails closed when command line inspection is unavailable', async () => {
    const trusted = await Effect.runPromise(
      isTrustedPidRecord({
        pid: 123,
        cmd: [process.execPath, '--import', 'tsx', mainPath(), 'api', 'serve'],
      }).pipe(Effect.provideService(Process, makeProcess(undefined) as any)),
    );

    expect(trusted).toBe(false);
  });

  it('accepts the exact agent-remnote service command line', async () => {
    const commandLine = `${process.execPath} --import tsx ${mainPath()} api serve`;
    const trusted = await Effect.runPromise(
      isTrustedPidRecord({
        pid: 123,
        cmd: [process.execPath, '--import', 'tsx', mainPath(), 'api', 'serve'],
      }).pipe(Effect.provideService(Process, makeProcess(commandLine) as any)),
    );

    expect(trusted).toBe(true);
  });
});
