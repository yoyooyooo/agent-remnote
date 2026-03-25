import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import os from 'node:os';
import path from 'node:path';

import { stopPluginServer } from '../../src/commands/plugin/stop.js';
import { PluginServerFiles } from '../../src/services/PluginServerFiles.js';
import { Process } from '../../src/services/Process.js';
import { CliError } from '../../src/services/Errors.js';

describe('plugin stop (unit)', () => {
  it('treats ESRCH during SIGTERM as an already-stopped stale process', async () => {
    const deletedPidFiles: string[] = [];
    const deletedStateFiles: string[] = [];
    let waited = false;
    const runtimeScript = path.join(os.tmpdir(), 'agent-remnote-plugin-runtime.js');

    const result = await Effect.runPromise(
      stopPluginServer({
        force: false,
        pidFilePath: '/tmp/plugin-server.pid',
        stateFilePath: '/tmp/plugin-server.state.json',
      }).pipe(
        Effect.provideService(PluginServerFiles, {
          defaultPidFile: () => '/tmp/plugin-server.pid',
          defaultLogFile: () => '/tmp/plugin-server.log',
          defaultStateFile: () => '/tmp/plugin-server.state.json',
          readPidFile: () =>
            Effect.succeed({
              pid: 123,
              state_file: '/tmp/plugin-server.state.json',
              cmd: [process.execPath, runtimeScript, 'plugin', 'serve'],
            }),
          writePidFile: () => Effect.void,
          deletePidFile: (filePath) =>
            Effect.sync(() => {
              deletedPidFiles.push(filePath);
            }),
          readStateFile: () => Effect.succeed(undefined),
          writeStateFile: () => Effect.void,
          deleteStateFile: (filePath) =>
            Effect.sync(() => {
              deletedStateFiles.push(filePath);
            }),
        }),
        Effect.provideService(Process, {
          isPidRunning: () => Effect.succeed(true),
          getCommandLine: () => Effect.succeed(`${process.execPath} ${runtimeScript} plugin serve`),
          spawnDetached: () =>
            Effect.fail(new CliError({ code: 'INTERNAL', message: 'unexpected spawnDetached', exitCode: 1 })),
          kill: () =>
            Effect.fail(
              new CliError({
                code: 'INTERNAL',
                message: 'Failed to send signal (SIGTERM)',
                exitCode: 1,
                details: { code: 'ESRCH', error: 'kill ESRCH' },
              }),
            ),
          waitForExit: () =>
            Effect.sync(() => {
              waited = true;
              return true;
            }),
        }),
      ),
    );

    expect(result).toEqual({
      stopped: true,
      stale: true,
      pid: 123,
      pid_file: '/tmp/plugin-server.pid',
    });
    expect(deletedPidFiles).toEqual(['/tmp/plugin-server.pid']);
    expect(deletedStateFiles).toEqual(['/tmp/plugin-server.state.json']);
    expect(waited).toBe(false);
  });
});
