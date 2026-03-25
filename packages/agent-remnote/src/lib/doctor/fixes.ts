import * as Effect from 'effect/Effect';

import { API_START_WAIT_DEFAULT_MS, API_STOP_WAIT_DEFAULT_MS, startApiDaemon } from '../../commands/api/_shared.js';
import { PLUGIN_SERVER_START_WAIT_DEFAULT_MS, PLUGIN_SERVER_STOP_WAIT_DEFAULT_MS, startPluginServer } from '../../commands/plugin/_shared.js';
import { WS_START_WAIT_DEFAULT_MS, WS_STOP_WAIT_DEFAULT_MS, startWsSupervisor } from '../../commands/ws/_shared.js';
import { ApiDaemonFiles } from '../../services/ApiDaemonFiles.js';
import { AppConfig } from '../../services/AppConfig.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { CliError } from '../../services/Errors.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { PluginServerFiles } from '../../services/PluginServerFiles.js';
import { Process } from '../../services/Process.js';
import { StatusLineFile } from '../../services/StatusLineFile.js';
import { SupervisorState } from '../../services/SupervisorState.js';
import { UserConfigFile } from '../../services/UserConfigFile.js';
import { resolveManagedStateFile } from '../managedRuntimePaths.js';
import { isTrustedPidRecord } from '../pidTrust.js';
import { currentExpectedPluginBuildInfo } from '../pluginBuildInfo.js';
import { cleanupStatuslineArtifacts, resolveStatuslineArtifactPaths } from '../statuslineArtifacts.js';
import { currentRuntimeBuildInfo } from '../runtimeBuildInfo.js';
import type { DoctorFix, DoctorRestartSummary } from './types.js';
import { WsClient } from '../../services/WsClient.js';

function stopTrustedRuntime<R>(params: {
  readonly service: 'daemon' | 'api' | 'plugin';
  readonly pid: number;
  readonly pidFilePath: string;
  readonly stateFilePath: string;
  readonly stopWaitMs: number;
  readonly cleanup: Effect.Effect<void, CliError, R>;
}): Effect.Effect<void, CliError, Process | R> {
  return Effect.gen(function* () {
    const proc = yield* Process;
    yield* proc.kill(params.pid, 'SIGTERM');
    const exited = yield* proc.waitForExit({ pid: params.pid, timeoutMs: params.stopWaitMs });
    if (!exited) {
      yield* proc.kill(params.pid, 'SIGKILL');
      const killed = yield* proc.waitForExit({ pid: params.pid, timeoutMs: params.stopWaitMs });
      if (!killed) {
        return yield* Effect.fail(
          new CliError({
            code: 'INTERNAL',
            message: `Failed to stop mismatched ${params.service} runtime`,
            exitCode: 1,
            details: { pid: params.pid, pid_file: params.pidFilePath, state_file: params.stateFilePath },
          }),
        );
      }
    }
    yield* params.cleanup;
  });
}

export function applyDoctorFixes(): Effect.Effect<
  { readonly fixes: readonly DoctorFix[]; readonly changed: boolean; readonly restartSummary: DoctorRestartSummary },
  never,
  AppConfig | DaemonFiles | ApiDaemonFiles | PluginServerFiles | SupervisorState | Process | UserConfigFile | StatusLineFile | HostApiClient | WsClient
> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const daemonFiles = yield* DaemonFiles;
    const apiFiles = yield* ApiDaemonFiles;
    const pluginFiles = yield* PluginServerFiles;
    const supervisorState = yield* SupervisorState;
    const proc = yield* Process;
    const userConfig = yield* UserConfigFile;

    let changed = false;
    const fixes: DoctorFix[] = [];

    const cleaned: Array<{ service: string; pidFile: string; stateFile: string; pid: number }> = [];
    const cleanupFailures: Array<{ service: string; pidFile: string; stateFile: string; pid: number; error: string }> = [];
    const current = currentRuntimeBuildInfo();

    const daemonPidFile = daemonFiles.defaultPidFile();
    const daemonPidInfo = yield* daemonFiles.readPidFile(daemonPidFile).pipe(Effect.orElseSucceed(() => undefined));
    if (daemonPidInfo?.pid && !(yield* isTrustedPidRecord(daemonPidInfo))) {
      const daemonStateFile = resolveManagedStateFile({
        pidFilePath: daemonPidFile,
        defaultStateFilePath: supervisorState.defaultStateFile(),
        candidate: daemonPidInfo.state_file,
      });
      const result = yield* Effect.gen(function* () {
        yield* daemonFiles.deletePidFile(daemonPidFile);
        yield* supervisorState.deleteStateFile(daemonStateFile);
        return yield* cleanupStatuslineArtifacts(resolveStatuslineArtifactPaths({ cfg, pidInfo: daemonPidInfo }));
      }).pipe(Effect.either);
      if (result._tag === 'Right') {
        cleaned.push({ service: 'daemon', pidFile: daemonPidFile, stateFile: daemonStateFile, pid: daemonPidInfo.pid });
        changed = true;
      } else {
        cleanupFailures.push({
          service: 'daemon',
          pidFile: daemonPidFile,
          stateFile: daemonStateFile,
          pid: daemonPidInfo.pid,
          error: result.left.message,
        });
      }
    }

    const apiPidFile = apiFiles.defaultPidFile();
    const apiPidInfo = yield* apiFiles.readPidFile(apiPidFile).pipe(Effect.orElseSucceed(() => undefined));
    if (apiPidInfo?.pid && !(yield* isTrustedPidRecord(apiPidInfo))) {
      const apiStateFile = resolveManagedStateFile({
        pidFilePath: apiPidFile,
        defaultStateFilePath: apiFiles.defaultStateFile(),
        candidate: apiPidInfo.state_file,
      });
      const result = yield* Effect.gen(function* () {
        yield* apiFiles.deletePidFile(apiPidFile);
        yield* apiFiles.deleteStateFile(apiStateFile);
      }).pipe(Effect.either);
      if (result._tag === 'Right') {
        cleaned.push({ service: 'api', pidFile: apiPidFile, stateFile: apiStateFile, pid: apiPidInfo.pid });
        changed = true;
      } else {
        cleanupFailures.push({
          service: 'api',
          pidFile: apiPidFile,
          stateFile: apiStateFile,
          pid: apiPidInfo.pid,
          error: result.left.message,
        });
      }
    }

    const pluginPidFile = pluginFiles.defaultPidFile();
    const pluginPidInfo = yield* pluginFiles.readPidFile(pluginPidFile).pipe(Effect.orElseSucceed(() => undefined));
    if (pluginPidInfo?.pid && !(yield* isTrustedPidRecord(pluginPidInfo))) {
      const pluginStateFile = resolveManagedStateFile({
        pidFilePath: pluginPidFile,
        defaultStateFilePath: pluginFiles.defaultStateFile(),
        candidate: pluginPidInfo.state_file,
      });
      const result = yield* Effect.gen(function* () {
        yield* pluginFiles.deletePidFile(pluginPidFile);
        yield* pluginFiles.deleteStateFile(pluginStateFile);
      }).pipe(Effect.either);
      if (result._tag === 'Right') {
        cleaned.push({ service: 'plugin', pidFile: pluginPidFile, stateFile: pluginStateFile, pid: pluginPidInfo.pid });
        changed = true;
      } else {
        cleanupFailures.push({
          service: 'plugin',
          pidFile: pluginPidFile,
          stateFile: pluginStateFile,
          pid: pluginPidInfo.pid,
          error: result.left.message,
        });
      }
    }

    const resolvedPluginStateFile = resolveManagedStateFile({
      pidFilePath: pluginPidFile,
      defaultStateFilePath: pluginFiles.defaultStateFile(),
      candidate: pluginPidInfo?.state_file,
    });
    const pluginStateInfo = yield* pluginFiles
      .readStateFile(resolvedPluginStateFile)
      .pipe(Effect.orElseSucceed(() => undefined));

    fixes.push({
      id: 'runtime.cleanup_stale_artifacts',
      ok: cleanupFailures.length === 0,
      changed: cleaned.length > 0,
      summary:
        cleaned.length === 0 && cleanupFailures.length === 0
          ? 'No stale runtime artifacts needed cleanup'
          : cleanupFailures.length === 0
            ? `Cleaned ${cleaned.length} stale runtime artifact set(s)`
            : `Cleaned ${cleaned.length} stale runtime artifact set(s); ${cleanupFailures.length} cleanup failure(s) need manual follow-up`,
      details: {
        cleaned,
        failed: cleanupFailures,
      },
    });

    const configRepair = yield* userConfig.repair().pipe(Effect.either);
    if (configRepair._tag === 'Right') {
      if (configRepair.right.changed && configRepair.right.before.valid) changed = true;
      fixes.push({
        id: 'config.rewrite_canonical_user_config',
        ok: configRepair.right.before.valid,
        changed: configRepair.right.before.valid ? configRepair.right.changed : false,
        summary: !configRepair.right.before.valid
          ? 'Skipped config rewrite because the current config is invalid or conflicting'
          : configRepair.right.changed
            ? 'Rewrote user config into canonical form'
            : 'User config already canonical',
        details: {
          config_file: configRepair.right.configFile,
          before: configRepair.right.before,
          after: configRepair.right.after,
        },
      });
    } else {
      fixes.push({
        id: 'config.rewrite_canonical_user_config',
        ok: false,
        changed: false,
        summary: 'Failed to rewrite user config',
        details: { error: configRepair.left.message },
      });
    }

    const restartAttempted: string[] = [];
    const restartRestarted: string[] = [];
    const restartSkipped: string[] = [];
    const restartFailed: Array<{ service: string; error: string }> = [];

    const expectedPlugin = currentExpectedPluginBuildInfo();

    const daemonNeedsRestart =
      daemonPidInfo?.pid &&
      daemonPidInfo.build?.build_id &&
      daemonPidInfo.build.build_id !== current.build_id &&
      daemonPidInfo.mode === 'supervisor' &&
      (yield* isTrustedPidRecord(daemonPidInfo));
    if (daemonNeedsRestart) {
      const daemonStateFile = resolveManagedStateFile({
        pidFilePath: daemonPidFile,
        defaultStateFilePath: supervisorState.defaultStateFile(),
        candidate: daemonPidInfo.state_file,
      });
      restartAttempted.push('daemon');
      const stopped = yield* stopTrustedRuntime({
        service: 'daemon',
        pid: daemonPidInfo.pid,
        pidFilePath: daemonPidFile,
        stateFilePath: daemonStateFile,
        stopWaitMs: WS_STOP_WAIT_DEFAULT_MS,
        cleanup: Effect.gen(function* () {
          yield* daemonFiles.deletePidFile(daemonPidFile);
          yield* supervisorState.deleteStateFile(daemonStateFile);
          yield* cleanupStatuslineArtifacts(resolveStatuslineArtifactPaths({ cfg, pidInfo: daemonPidInfo }));
        }),
      }).pipe(Effect.either);
      if (stopped._tag === 'Right') {
        changed = true;
        const started = yield* startWsSupervisor({
          waitMs: WS_START_WAIT_DEFAULT_MS,
          pidFile: daemonPidFile,
          logFile: daemonPidInfo.log_file,
        }).pipe(Effect.either);
        if (started._tag === 'Right') {
          if (started.right.started) {
            restartRestarted.push('daemon');
          } else {
            restartSkipped.push('daemon_already_healthy_after_restart_attempt');
          }
        } else {
          restartFailed.push({ service: 'daemon', error: started.left.message });
        }
      } else {
        restartFailed.push({ service: 'daemon', error: stopped.left.message });
      }
    } else if (daemonPidInfo?.build?.build_id && daemonPidInfo.build.build_id !== current.build_id) {
      restartSkipped.push('daemon_restart_not_safe');
    }

    const apiNeedsRestart =
      apiPidInfo?.pid &&
      apiPidInfo.build?.build_id &&
      apiPidInfo.build.build_id !== current.build_id &&
      (yield* isTrustedPidRecord(apiPidInfo));
    if (apiNeedsRestart) {
      const apiStateFile = resolveManagedStateFile({
        pidFilePath: apiPidFile,
        defaultStateFilePath: apiFiles.defaultStateFile(),
        candidate: apiPidInfo.state_file,
      });
      restartAttempted.push('api');
      const stopped = yield* stopTrustedRuntime({
        service: 'api',
        pid: apiPidInfo.pid,
        pidFilePath: apiPidFile,
        stateFilePath: apiStateFile,
        stopWaitMs: API_STOP_WAIT_DEFAULT_MS,
        cleanup: Effect.gen(function* () {
          yield* apiFiles.deletePidFile(apiPidFile);
          yield* apiFiles.deleteStateFile(apiStateFile);
        }),
      }).pipe(Effect.either);
      if (stopped._tag === 'Right') {
        changed = true;
        const started = yield* startApiDaemon({
          host: apiPidInfo.host,
          port: apiPidInfo.port,
          basePath: apiPidInfo.base_path,
          waitMs: API_START_WAIT_DEFAULT_MS,
          pidFile: apiPidFile,
          logFile: apiPidInfo.log_file,
          stateFile: apiStateFile,
        }).pipe(Effect.either);
        if (started._tag === 'Right') {
          if (started.right.started) {
            restartRestarted.push('api');
          } else {
            restartSkipped.push('api_already_healthy_after_restart_attempt');
          }
        } else {
          restartFailed.push({ service: 'api', error: started.left.message });
        }
      } else {
        restartFailed.push({ service: 'api', error: stopped.left.message });
      }
    } else if (apiPidInfo?.build?.build_id && apiPidInfo.build.build_id !== current.build_id) {
      restartSkipped.push('api_restart_not_safe');
    }

    const pluginArtifactMismatch =
      expectedPlugin &&
      pluginStateInfo?.plugin_build?.build_id &&
      pluginStateInfo.plugin_build.build_id !== expectedPlugin.build_id;
    const pluginRuntimeMismatch =
      pluginPidInfo?.build?.build_id &&
      pluginPidInfo.build.build_id !== current.build_id;
    const pluginNeedsRestart =
      pluginPidInfo?.pid &&
      (pluginRuntimeMismatch || pluginArtifactMismatch) &&
      (yield* isTrustedPidRecord(pluginPidInfo));
    if (pluginNeedsRestart) {
      const pluginStateFile = resolveManagedStateFile({
        pidFilePath: pluginPidFile,
        defaultStateFilePath: pluginFiles.defaultStateFile(),
        candidate: pluginPidInfo.state_file,
      });
      restartAttempted.push('plugin');
      const stopped = yield* stopTrustedRuntime({
        service: 'plugin',
        pid: pluginPidInfo.pid,
        pidFilePath: pluginPidFile,
        stateFilePath: pluginStateFile,
        stopWaitMs: PLUGIN_SERVER_STOP_WAIT_DEFAULT_MS,
        cleanup: Effect.gen(function* () {
          yield* pluginFiles.deletePidFile(pluginPidFile);
          yield* pluginFiles.deleteStateFile(pluginStateFile);
        }),
      }).pipe(Effect.either);
      if (stopped._tag === 'Right') {
        changed = true;
        const started = yield* startPluginServer({
          host: pluginPidInfo.host,
          port: pluginPidInfo.port,
          waitMs: PLUGIN_SERVER_START_WAIT_DEFAULT_MS,
          pidFile: pluginPidFile,
          logFile: pluginPidInfo.log_file,
          stateFile: pluginStateFile,
        }).pipe(Effect.either);
        if (started._tag === 'Right') {
          if (started.right.started) {
            restartRestarted.push('plugin');
          } else {
            restartSkipped.push('plugin_already_healthy_after_restart_attempt');
          }
        } else {
          restartFailed.push({ service: 'plugin', error: started.left.message });
        }
      } else {
        restartFailed.push({ service: 'plugin', error: stopped.left.message });
      }
    } else if (pluginRuntimeMismatch || pluginArtifactMismatch) {
      restartSkipped.push('plugin_restart_not_safe');
    }

    const restartSummary: DoctorRestartSummary = {
      attempted: restartAttempted,
      restarted: restartRestarted,
      skipped: restartSkipped,
      failed: restartFailed,
    };

    fixes.push({
      id: 'runtime.restart_mismatched_services',
      ok: restartFailed.length === 0,
      changed: restartRestarted.length > 0,
      summary:
        restartAttempted.length === 0
          ? 'No trusted runtime build mismatches required automatic restart'
          : restartFailed.length === 0
            ? `Restarted ${restartRestarted.length} mismatched runtime service(s)`
            : `Restarted ${restartRestarted.length} mismatched runtime service(s); ${restartFailed.length} restart(s) failed`,
      details: restartSummary,
    });

    return { fixes, changed, restartSummary };
  });
}
