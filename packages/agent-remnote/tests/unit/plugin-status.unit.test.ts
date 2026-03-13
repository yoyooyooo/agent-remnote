import { describe, expect, it } from 'vitest';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import os from 'node:os';
import path from 'node:path';

import { getPluginStatus } from '../../src/commands/plugin/status.js';
import { CliError } from '../../src/services/Errors.js';
import { PluginServerFiles } from '../../src/services/PluginServerFiles.js';
import { Process } from '../../src/services/Process.js';

describe('plugin status (unit)', () => {
  it('prefers state_file from pid metadata when no explicit --state-file is provided', async () => {
    const readStatePaths: string[] = [];
    const tmp = os.tmpdir();
    const pidFile = path.join(tmp, 'plugin-server.pid');
    const logFile = path.join(tmp, 'plugin-server.log');
    const defaultStateFile = path.join(tmp, 'default-plugin-server.state.json');
    const customStateFile = path.join(tmp, 'custom-plugin-server.state.json');
    const distPath = path.join(tmp, 'dist');

    const result = await Effect.runPromise(
      getPluginStatus({
        pidFilePath: pidFile,
        explicitStateFilePath: undefined,
      }).pipe(
        Effect.provideService(PluginServerFiles, {
          defaultPidFile: () => pidFile,
          defaultLogFile: () => logFile,
          defaultStateFile: () => defaultStateFile,
          readPidFile: () =>
            Effect.succeed({
              pid: 123,
              host: '127.0.0.1',
              port: 8080,
              state_file: customStateFile,
              log_file: logFile,
            }),
          writePidFile: () => Effect.void,
          deletePidFile: () => Effect.void,
          readStateFile: (filePath) =>
            Effect.sync(() => {
              readStatePaths.push(filePath);
              return {
                running: true,
                pid: 123,
                host: '127.0.0.1',
                port: 8080,
                startedAt: 1,
                localBaseUrl: 'http://127.0.0.1:8080',
                distPath,
              };
            }),
          writeStateFile: () => Effect.void,
          deleteStateFile: () => Effect.void,
        }),
        Effect.provideService(Process, {
          isPidRunning: () => Effect.succeed(true),
          spawnDetached: () => Effect.die('unexpected spawnDetached'),
          kill: () => Effect.die('unexpected kill'),
          waitForExit: () => Effect.die('unexpected waitForExit'),
        }),
      ),
    );

    expect(readStatePaths).toEqual([customStateFile]);
    expect(result.service.state_file).toBe(customStateFile);
  });

  it('keeps typed failures in the error channel', async () => {
    const exit = await Effect.runPromise(
      getPluginStatus({
        pidFilePath: path.join(os.tmpdir(), 'plugin-server.pid'),
        explicitStateFilePath: undefined,
      }).pipe(
        Effect.provideService(PluginServerFiles, {
          defaultPidFile: () => path.join(os.tmpdir(), 'plugin-server.pid'),
          defaultLogFile: () => path.join(os.tmpdir(), 'plugin-server.log'),
          defaultStateFile: () => path.join(os.tmpdir(), 'plugin-server.state.json'),
          readPidFile: () =>
            Effect.fail(new CliError({ code: 'INTERNAL', message: 'boom', exitCode: 1 })),
          writePidFile: () => Effect.void,
          deletePidFile: () => Effect.void,
          readStateFile: () => Effect.succeed(undefined),
          writeStateFile: () => Effect.void,
          deleteStateFile: () => Effect.void,
        }),
        Effect.provideService(Process, {
          isPidRunning: () => Effect.succeed(false),
          spawnDetached: () => Effect.die('unexpected spawnDetached'),
          kill: () => Effect.die('unexpected kill'),
          waitForExit: () => Effect.die('unexpected waitForExit'),
        }),
        Effect.exit,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) return;
    const failure = Cause.failureOption(exit.cause);
    expect(Option.isSome(failure)).toBe(true);
    if (Option.isNone(failure)) return;
    expect(failure.value).toMatchObject({ _tag: 'CliError', message: 'boom' });
  });
});
