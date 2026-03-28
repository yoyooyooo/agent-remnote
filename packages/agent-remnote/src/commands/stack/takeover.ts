import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import path from 'node:path';

import { CliError, isCliError } from '../../services/Errors.js';
import { API_START_WAIT_DEFAULT_MS, ensureApiDaemon } from '../api/_shared.js';
import { desiredFixedOwnerClaim, readFixedOwnerClaim, writeFixedOwnerClaim } from '../../lib/runtime-ownership/claim.js';
import { resolveStableLauncherSpec } from '../../lib/runtime-ownership/launcher.js';
import { ownerDescriptorForClaim } from '../../lib/runtime-ownership/ownerDescriptor.js';
import { resolveRuntimeOwnershipContext } from '../../lib/runtime-ownership/profile.js';
import { PLUGIN_SERVER_START_WAIT_DEFAULT_MS, ensurePluginServer } from '../plugin/_shared.js';
import { Process } from '../../services/Process.js';
import { stopStackBundle } from './stop.js';
import { WS_START_WAIT_DEFAULT_MS, ensureWsSupervisor } from '../ws/_shared.js';
import { writeFailure, writeSuccess } from '../_shared.js';

const channel = Options.choice('channel', ['stable', 'dev'] as const);

export function runStackTakeover(channel: 'stable' | 'dev') {
  return Effect.gen(function* () {
    const proc = yield* Process;
    const ownership = resolveRuntimeOwnershipContext();
    const previous = readFixedOwnerClaim(ownership);
    const nextClaim = desiredFixedOwnerClaim({ ctx: ownership, channel, updatedBy: 'stack_takeover' });

    const stoppedServices: string[] = [];
    const restartedServices: string[] = [];
    const skippedServices: string[] = [];
    if (channel === 'dev') {
      const ownerOverride = ownerDescriptorForClaim({
        claim: nextClaim,
        currentRuntimeRoot: ownership.runtimeRoot,
        repoRoot: ownership.repoRoot,
        worktreeRoot: ownership.worktreeRoot,
      });
      const envOverride = {
        AGENT_REMNOTE_OWNER_CHANNEL: ownerOverride.owner_channel,
        AGENT_REMNOTE_OWNER_INSTALL_SOURCE: ownerOverride.install_source,
        AGENT_REMNOTE_OWNER_RUNTIME_ROOT: ownerOverride.runtime_root,
        AGENT_REMNOTE_OWNER_REPO_ROOT: ownerOverride.repo_root ?? '',
        AGENT_REMNOTE_OWNER_WORKTREE_ROOT: ownerOverride.worktree_root ?? '',
        AGENT_REMNOTE_OWNER_PORT_CLASS: ownerOverride.port_class,
        AGENT_REMNOTE_LAUNCHER_REF: ownerOverride.launcher_ref,
        AGENT_REMNOTE_BYPASS_CLAIM_GUARD: '1',
      } satisfies NodeJS.ProcessEnv;
      const previousBypass = process.env.AGENT_REMNOTE_BYPASS_CLAIM_GUARD;
      yield* Effect.sync(() => {
        process.env.AGENT_REMNOTE_BYPASS_CLAIM_GUARD = '1';
      });
      yield* Effect.gen(function* () {
        const daemon = yield* ensureWsSupervisor({
          waitMs: WS_START_WAIT_DEFAULT_MS,
          wsUrlOverride: 'ws://localhost:6789/ws',
          ownerOverride,
          envOverride,
        });
        if (daemon.started) restartedServices.push('daemon');
        else skippedServices.push('daemon');

        const api = yield* ensureApiDaemon({
          waitMs: API_START_WAIT_DEFAULT_MS,
          port: 3000,
          ownerOverride,
          envOverride,
        });
        if (api.started) restartedServices.push('api');
        else skippedServices.push('api');

        const plugin = yield* ensurePluginServer({
          waitMs: PLUGIN_SERVER_START_WAIT_DEFAULT_MS,
          port: 8080,
          ownerOverride,
          envOverride,
        });
        if (plugin.started) restartedServices.push('plugin');
        else skippedServices.push('plugin');
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (previousBypass === undefined) delete process.env.AGENT_REMNOTE_BYPASS_CLAIM_GUARD;
            else process.env.AGENT_REMNOTE_BYPASS_CLAIM_GUARD = previousBypass;
          }),
        ),
      );

      yield* Effect.try({
        try: () => writeFixedOwnerClaim({ file: previous.file, ctx: ownership, claim: nextClaim }),
        catch: (error) =>
          isCliError(error)
            ? error
            : new CliError({
                code: 'INTERNAL',
                message: 'Failed to write fixed owner claim during stack takeover',
                exitCode: 1,
                details: { error: String((error as any)?.message || error), file: previous.file },
              }),
      });
    } else {
      yield* Effect.try({
        try: () => writeFixedOwnerClaim({ file: previous.file, ctx: ownership, claim: nextClaim }),
        catch: (error) =>
          isCliError(error)
            ? error
            : new CliError({
                code: 'INTERNAL',
                message: 'Failed to write fixed owner claim during stack takeover',
                exitCode: 1,
                details: { error: String((error as any)?.message || error), file: previous.file },
              }),
      });

      const stopped = yield* stopStackBundle();
      if (stopped.daemon_stopped) stoppedServices.push('daemon');
      if (stopped.api_stopped) stoppedServices.push('api');
      if (stopped.plugin_stopped) stoppedServices.push('plugin');

      const launcher = yield* Effect.try({
        try: () => resolveStableLauncherSpec(),
        catch: (error) =>
          isCliError(error)
            ? error
            : new CliError({
                code: 'INTERNAL',
                message: 'Failed to resolve stable launcher',
                exitCode: 1,
                details: { error: String((error as any)?.message || error) },
              }),
      });

      if (launcher) {
        yield* proc.spawnDetached({
          command: launcher.command,
          args: launcher.args,
          cwd: launcher.cwd,
          env: process.env,
          logFile: path.join(ownership.controlPlaneRoot, 'stable-launcher.log'),
        });
        restartedServices.push('stable-launcher');
      } else {
        skippedServices.push('stable-launcher');
      }
    }

    return {
      previous_claim: previous.claim,
      next_claim: nextClaim,
      claim_file: previous.file,
      stopped_services: stoppedServices,
      restarted_services: restartedServices,
      skipped_services: skippedServices,
      failed_services: [] as Array<{ service: string; error: string }>,
      remnote_reload_required: false,
      warnings: [] as string[],
      next_actions: [] as string[],
    };
  });
}

export const stackTakeoverCommand = Command.make('takeover', { channel }, ({ channel }) =>
  Effect.gen(function* () {
    const data = yield* runStackTakeover(channel);

    const md = [
      `- previous_claimed_channel: ${data.previous_claim.claimed_channel}`,
      `- next_claimed_channel: ${data.next_claim.claimed_channel}`,
      `- claim_file: ${data.claim_file}`,
      `- remnote_reload_required: ${data.remnote_reload_required}`,
    ].join('\n');

    yield* writeSuccess({ data, md });
  }).pipe(Effect.catchAll(writeFailure)),
);
