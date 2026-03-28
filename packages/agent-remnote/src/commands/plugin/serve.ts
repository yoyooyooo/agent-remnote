import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { resolvePluginDistPath } from '../../lib/pluginArtifacts.js';
import { readPluginDistBuildInfo } from '../../lib/pluginBuildInfo.js';
import { runPluginStaticRuntime } from '../../runtime/plugin-static/runPluginStaticRuntime.js';
import { AppConfig } from '../../services/AppConfig.js';
import { CliError, isCliError } from '../../services/Errors.js';
import { Output } from '../../services/Output.js';
import { PluginServerFiles } from '../../services/PluginServerFiles.js';
import { resolveUserFilePath } from '../../lib/paths.js';
import { currentRuntimeBuildInfo } from '../../lib/runtimeBuildInfo.js';
import { currentRuntimeOwnerDescriptor } from '../../lib/runtime-ownership/ownerDescriptor.js';
import { writeFailure } from '../_shared.js';
import { pluginServerLocalBaseUrl } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const host = Options.text('host').pipe(Options.optional, Options.map(optionToUndefined));
const port = Options.integer('port').pipe(Options.optional, Options.map(optionToUndefined));
const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));

export const pluginServeCommand = Command.make('serve', { host, port, stateFile }, ({ host, port, stateFile }) =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const out = yield* Output;
    const files = yield* PluginServerFiles;
    const distPath = yield* Effect.try({
      try: () => resolvePluginDistPath(),
      catch: (error) =>
        isCliError(error)
          ? error
          : new CliError({
              code: 'DEPENDENCY_MISSING',
              message: 'Plugin build artifacts are unavailable',
              exitCode: 1,
              details: { error: String((error as any)?.message || error) },
            }),
    });
    const bindHost = host ?? '127.0.0.1';
    const bindPort = port ?? 8080;
    const stateFilePath = stateFile ? resolveUserFilePath(stateFile) : undefined;

    const runtime = runPluginStaticRuntime({
      host: bindHost,
      port: bindPort,
      distPath,
      onStarted: ({ host, port, distPath }) =>
        Effect.gen(function* () {
          const baseUrl = pluginServerLocalBaseUrl(host, port);
          if (stateFilePath) {
            yield* files.writeStateFile(stateFilePath, {
              running: true,
              pid: process.pid,
              build: currentRuntimeBuildInfo(),
              owner: currentRuntimeOwnerDescriptor(),
              plugin_build: readPluginDistBuildInfo(distPath) ?? undefined,
              host,
              port,
              startedAt: Date.now(),
              localBaseUrl: baseUrl,
              distPath,
            });
          }

          if (cfg.format === 'json' || cfg.quiet || cfg.format === 'ids') return;
          yield* out.stdout(
            cfg.debug
              ? `\n  agent-remnote plugin ready\n\n  Local:   ${baseUrl}/\n  Dist:    ${distPath}\n`
              : `\n  agent-remnote plugin ready\n\n  Local:   ${baseUrl}/\n`,
          );
        }),
    }).pipe(
      Effect.ensuring(
        stateFilePath ? files.deleteStateFile(stateFilePath).pipe(Effect.catchAll(() => Effect.void)) : Effect.void,
      ),
    );

    yield* runtime;
  }).pipe(Effect.catchAll(writeFailure)),
);
