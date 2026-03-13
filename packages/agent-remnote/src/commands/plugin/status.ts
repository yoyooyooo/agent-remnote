import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { PluginServerFiles } from '../../services/PluginServerFiles.js';
import { Process } from '../../services/Process.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import {
  checkPluginServerHealth,
  PLUGIN_SERVER_DEFAULT_HOST,
  PLUGIN_SERVER_DEFAULT_PORT,
  PLUGIN_SERVER_HEALTH_TIMEOUT_MS,
  pluginServerLocalBaseUrl,
} from './_shared.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));
const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));

export const pluginStatusCommand = Command.make('status', { pidFile, stateFile }, ({ pidFile, stateFile }) =>
  Effect.gen(function* () {
    const files = yield* PluginServerFiles;
    const proc = yield* Process;

    const pidFilePath = resolveUserFilePath(pidFile ?? files.defaultPidFile());
    const stateFilePath = resolveUserFilePath(stateFile ?? files.defaultStateFile());
    const pidInfo = yield* files.readPidFile(pidFilePath);
    const state = yield* files.readStateFile(stateFilePath);

    const pid = pidInfo?.pid;
    const running = typeof pid === 'number' ? yield* proc.isPidRunning(pid) : false;
    const host = pidInfo?.host ?? state?.host ?? PLUGIN_SERVER_DEFAULT_HOST;
    const port = pidInfo?.port ?? state?.port ?? PLUGIN_SERVER_DEFAULT_PORT;
    const baseUrl = pluginServerLocalBaseUrl(host, port);

    const health = yield* checkPluginServerHealth(baseUrl, PLUGIN_SERVER_HEALTH_TIMEOUT_MS).pipe(Effect.either);

    const data = {
      service: {
        running,
        pid: pid ?? null,
        pid_file: pidFilePath,
        log_file: pidInfo?.log_file ?? files.defaultLogFile(),
        state_file: pidInfo?.state_file ?? stateFilePath,
        started_at: pidInfo?.started_at ?? state?.startedAt ?? null,
      },
      state: state ?? null,
      plugin_server: {
        healthy: health._tag === 'Right',
        base_url: baseUrl,
        host,
        port,
        dist_path: state?.distPath ?? '',
        error: health._tag === 'Left' ? health.left.message : undefined,
      },
    };

    const md = [
      `- service_running: ${data.service.running}`,
      `- pid: ${data.service.pid ?? ''}`,
      `- pid_file: ${data.service.pid_file}`,
      `- log_file: ${data.service.log_file}`,
      `- state_file: ${data.service.state_file}`,
      `- started_at: ${data.service.started_at ?? ''}`,
      `- plugin_server_healthy: ${data.plugin_server.healthy}`,
      `- base_url: ${data.plugin_server.base_url}`,
      `- host: ${data.plugin_server.host}`,
      `- port: ${data.plugin_server.port}`,
      `- dist_path: ${data.plugin_server.dist_path}`,
    ].join('\n');

    yield* writeSuccess({ data, md });
  }).pipe(Effect.catchAll(writeFailure)),
);
