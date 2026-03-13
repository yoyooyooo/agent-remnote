import { describe, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';

import { getPluginStatus } from '../../src/commands/plugin/status.js';
import { PluginServerFiles } from '../../src/services/PluginServerFiles.js';
import { Process } from '../../src/services/Process.js';

describe('plugin status (unit)', () => {
  it('prefers state_file from pid metadata when no explicit --state-file is provided', async () => {
    const readStatePaths: string[] = [];

    const result = await Effect.runPromise(
      getPluginStatus({
        pidFilePath: '/tmp/plugin-server.pid',
        explicitStateFilePath: undefined,
      }).pipe(
        Effect.provideService(PluginServerFiles, {
          defaultPidFile: () => '/tmp/plugin-server.pid',
          defaultLogFile: () => '/tmp/plugin-server.log',
          defaultStateFile: () => '/tmp/default-plugin-server.state.json',
          readPidFile: () =>
            Effect.succeed({
              pid: 123,
              host: '127.0.0.1',
              port: 8080,
              state_file: '/tmp/custom-plugin-server.state.json',
              log_file: '/tmp/plugin-server.log',
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
                distPath: '/tmp/dist',
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

    expect(readStatePaths).toEqual(['/tmp/custom-plugin-server.state.json']);
    expect(result.service.state_file).toBe('/tmp/custom-plugin-server.state.json');
  });
});
