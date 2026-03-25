import { Command } from '@effect/cli';
import * as Effect from 'effect/Effect';
import path from 'node:path';

import { ApiDaemonFiles } from '../../services/ApiDaemonFiles.js';
import { CliError } from '../../services/Errors.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { Process } from '../../services/Process.js';
import { SupervisorState } from '../../services/SupervisorState.js';
import { requireTrustedPidRecord } from '../../lib/pidTrust.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { API_STOP_WAIT_DEFAULT_MS } from '../api/_shared.js';
import { WS_STOP_WAIT_DEFAULT_MS } from '../ws/_shared.js';

export const stackStopCommand = Command.make('stop', {}, () =>
  Effect.gen(function* () {
    const apiFiles = yield* ApiDaemonFiles;
    const daemonFiles = yield* DaemonFiles;
    const proc = yield* Process;
    const supervisorState = yield* SupervisorState;

    const apiPidFile = resolveUserFilePath(apiFiles.defaultPidFile());
    const apiPidInfo = yield* apiFiles.readPidFile(apiPidFile);
    let apiStopped = true;
    if (apiPidInfo && (yield* proc.isPidRunning(apiPidInfo.pid))) {
      yield* requireTrustedPidRecord({ record: apiPidInfo, pidFilePath: apiPidFile });
      yield* proc.kill(apiPidInfo.pid, 'SIGTERM');
      const exited = yield* proc.waitForExit({ pid: apiPidInfo.pid, timeoutMs: API_STOP_WAIT_DEFAULT_MS });
      if (!exited) {
        yield* proc.kill(apiPidInfo.pid, 'SIGKILL');
        const killed = yield* proc.waitForExit({ pid: apiPidInfo.pid, timeoutMs: API_STOP_WAIT_DEFAULT_MS });
        if (!killed) {
          return yield* Effect.fail(
            new CliError({ code: 'INTERNAL', message: 'Failed to stop api process', exitCode: 1 }),
          );
        }
      }
    }
    yield* apiFiles.deletePidFile(apiPidFile).pipe(Effect.catchAll(() => Effect.void));
    yield* apiFiles
      .deleteStateFile(apiFiles.defaultStateFile())
      .pipe(Effect.catchAll(() => Effect.void));

    const daemonPidFile = resolveUserFilePath(daemonFiles.defaultPidFile());
    const daemonPidInfo = yield* daemonFiles.readPidFile(daemonPidFile);
    let daemonStopped = true;
    if (daemonPidInfo && (yield* proc.isPidRunning(daemonPidInfo.pid))) {
      yield* requireTrustedPidRecord({ record: daemonPidInfo, pidFilePath: daemonPidFile });
      yield* proc.kill(daemonPidInfo.pid, 'SIGTERM');
      const exited = yield* proc.waitForExit({ pid: daemonPidInfo.pid, timeoutMs: WS_STOP_WAIT_DEFAULT_MS });
      if (!exited) {
        yield* proc.kill(daemonPidInfo.pid, 'SIGKILL');
        const killed = yield* proc.waitForExit({ pid: daemonPidInfo.pid, timeoutMs: WS_STOP_WAIT_DEFAULT_MS });
        if (!killed) {
          return yield* Effect.fail(
            new CliError({ code: 'INTERNAL', message: 'Failed to stop daemon process', exitCode: 1 }),
          );
        }
      }
    }
    yield* daemonFiles.deletePidFile(daemonPidFile).pipe(Effect.catchAll(() => Effect.void));
    yield* supervisorState
      .deleteStateFile(resolveUserFilePath(path.join(path.dirname(daemonPidFile), 'ws.state.json')))
      .pipe(Effect.catchAll(() => Effect.void));

    yield* writeSuccess({
      data: { stopped: true, api_stopped: apiStopped, daemon_stopped: daemonStopped },
      md: `- stopped: true\n- api_stopped: ${apiStopped}\n- daemon_stopped: ${daemonStopped}\n`,
    });
  }).pipe(Effect.catchAll(writeFailure)),
);
