import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { PluginServerFiles } from '../../services/PluginServerFiles.js';
import { Process } from '../../services/Process.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { checkPluginServerHealth } from '../../lib/pluginServerHealth.js';
import { currentExpectedPluginBuildInfo } from '../../lib/pluginBuildInfo.js';
import { currentRuntimeBuildInfo } from '../../lib/runtimeBuildInfo.js';
import { CliError } from '../../services/Errors.js';
import {
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

export function getPluginStatus(params: {
  readonly pidFilePath: string;
  readonly explicitStateFilePath?: string | undefined;
}): Effect.Effect<
  {
    readonly runtime: import('../../lib/runtimeBuildInfo.js').RuntimeBuildInfo;
    readonly service: {
      readonly running: boolean;
      readonly pid: number | null;
      readonly build: import('../../lib/runtimeBuildInfo.js').RuntimeBuildInfo | null;
      readonly owner: import('../../lib/runtime-ownership/ownerDescriptor.js').RuntimeOwnerDescriptor | null;
      readonly pid_file: string;
      readonly log_file: string;
      readonly state_file: string;
      readonly started_at: number | null;
    };
    readonly state: any;
    readonly plugin_server: {
      readonly healthy: boolean;
      readonly base_url: string;
      readonly host: string;
      readonly port: number;
      readonly dist_path: string;
      readonly build: import('../../lib/runtimeBuildInfo.js').RuntimeBuildInfo | null;
      readonly error?: string | undefined;
    };
    readonly warnings?: readonly string[] | undefined;
  },
  CliError,
  PluginServerFiles | Process
> {
  return Effect.gen(function* () {
    const files = yield* PluginServerFiles;
    const proc = yield* Process;

    const pidInfo = yield* files.readPidFile(params.pidFilePath);
    const effectiveStateFilePath = resolveUserFilePath(
      params.explicitStateFilePath ?? pidInfo?.state_file ?? files.defaultStateFile(),
    );
    const state = yield* files.readStateFile(effectiveStateFilePath);

    const pid = pidInfo?.pid;
    const running = typeof pid === 'number' ? yield* proc.isPidRunning(pid) : false;
    const host = pidInfo?.host ?? state?.host ?? PLUGIN_SERVER_DEFAULT_HOST;
    const port = pidInfo?.port ?? state?.port ?? PLUGIN_SERVER_DEFAULT_PORT;
    const baseUrl = pluginServerLocalBaseUrl(host, port);

    const health = yield* checkPluginServerHealth(baseUrl, PLUGIN_SERVER_HEALTH_TIMEOUT_MS).pipe(Effect.either);

    const runtime = currentRuntimeBuildInfo();
    const serviceBuild = pidInfo?.build ?? state?.build ?? null;
    const pluginBuild = state?.plugin_build ?? null;
    const warnings: string[] = [];
    if (serviceBuild && serviceBuild.build_id !== runtime.build_id) {
      warnings.push(`plugin server process build mismatch: current=${runtime.build_id} live=${serviceBuild.build_id}`);
    }
    const expectedPluginBuild = currentExpectedPluginBuildInfo();
    if (expectedPluginBuild && pluginBuild && pluginBuild.build_id !== expectedPluginBuild.build_id) {
      warnings.push(`served plugin build mismatch: expected=${expectedPluginBuild.build_id} live=${pluginBuild.build_id}`);
    }
    if (running && !serviceBuild) {
      warnings.push('plugin server pid/state metadata has no build info; restart plugin server to refresh runtime metadata');
    }
    if (running && !pluginBuild) {
      warnings.push('served plugin artifact build info is unavailable; rebuild plugin artifacts and restart plugin server');
    }

    return {
      runtime,
      service: {
        running,
        pid: pid ?? null,
        build: serviceBuild,
        owner: pidInfo?.owner ?? state?.owner ?? null,
        pid_file: params.pidFilePath,
        log_file: pidInfo?.log_file ?? files.defaultLogFile(),
        state_file: effectiveStateFilePath,
        started_at: pidInfo?.started_at ?? state?.startedAt ?? null,
      },
      state: state ?? null,
      plugin_server: {
        healthy: health._tag === 'Right',
        base_url: baseUrl,
        host,
        port,
        dist_path: state?.distPath ?? '',
        build: pluginBuild,
        error: health._tag === 'Left' ? health.left.message : undefined,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  });
}

export const pluginStatusCommand = Command.make('status', { pidFile, stateFile }, ({ pidFile, stateFile }) =>
  Effect.gen(function* () {
    const files = yield* PluginServerFiles;

    const pidFilePath = resolveUserFilePath(pidFile ?? files.defaultPidFile());
    const data = yield* getPluginStatus({
      pidFilePath,
      explicitStateFilePath: stateFile ? resolveUserFilePath(stateFile) : undefined,
    });

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
