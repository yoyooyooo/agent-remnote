import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { AppConfig } from '../../services/AppConfig.js';
import { ApiDaemonFiles } from '../../services/ApiDaemonFiles.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { Process } from '../../services/Process.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { apiLocalBaseUrl } from '../../lib/apiUrls.js';
import { writeFailure, writeSuccess } from '../_shared.js';
import { API_HEALTH_TIMEOUT_MS } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const pidFile = Options.text('pid-file').pipe(Options.optional, Options.map(optionToUndefined));
const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));

export const apiStatusCommand = Command.make('status', { pidFile, stateFile }, ({ pidFile, stateFile }) =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const apiFiles = yield* ApiDaemonFiles;
    const proc = yield* Process;
    const api = yield* HostApiClient;

    const pidFilePath = resolveUserFilePath(pidFile ?? apiFiles.defaultPidFile());
    const stateFilePath = resolveUserFilePath(stateFile ?? apiFiles.defaultStateFile());
    const pidInfo = yield* apiFiles.readPidFile(pidFilePath);
    const state = yield* apiFiles.readStateFile(stateFilePath);

    const pid = pidInfo?.pid;
    const running = typeof pid === 'number' ? yield* proc.isPidRunning(pid) : false;
    const port = pidInfo?.port ?? state?.port ?? cfg.apiPort ?? 3000;
    const basePath = pidInfo?.base_path ?? state?.basePath ?? cfg.apiBasePath ?? '/v1';
    const localBaseUrl = apiLocalBaseUrl(port, basePath);

    const health = yield* api.health({ baseUrl: localBaseUrl, timeoutMs: API_HEALTH_TIMEOUT_MS }).pipe(Effect.either);
    const status = yield* api.status({ baseUrl: localBaseUrl, timeoutMs: API_HEALTH_TIMEOUT_MS }).pipe(Effect.either);

    const data = {
      service: {
        running,
        pid: pid ?? null,
        pid_file: pidFilePath,
        log_file: pidInfo?.log_file ?? cfg.apiLogFile ?? apiFiles.defaultLogFile(),
        state_file: pidInfo?.state_file ?? stateFilePath,
        started_at: pidInfo?.started_at ?? state?.startedAt ?? null,
      },
      state: state ?? null,
      api: {
        healthy: health._tag === 'Right',
        base_url: localBaseUrl,
        base_path: basePath,
        status: status._tag === 'Right' ? status.right : null,
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
      `- api_healthy: ${data.api.healthy}`,
      `- base_url: ${data.api.base_url}`,
      `- base_path: ${data.api.base_path}`,
      `- db_read_ready: ${data.api.status?.capabilities?.db_read_ready ?? ''}`,
      `- plugin_rpc_ready: ${data.api.status?.capabilities?.plugin_rpc_ready ?? ''}`,
      `- write_ready: ${data.api.status?.capabilities?.write_ready ?? ''}`,
      `- ui_session_ready: ${data.api.status?.capabilities?.ui_session_ready ?? ''}`,
      `- workspace_resolved: ${data.api.status?.workspace?.resolved ?? ''}`,
      `- current_workspace_id: ${data.api.status?.workspace?.currentWorkspaceId ?? ''}`,
      `- current_db_path: ${data.api.status?.workspace?.currentDbPath ?? ''}`,
      `- binding_source: ${data.api.status?.workspace?.bindingSource ?? ''}`,
    ].join('\n');

    yield* writeSuccess({ data, md });
  }).pipe(Effect.catchAll(writeFailure)),
);
