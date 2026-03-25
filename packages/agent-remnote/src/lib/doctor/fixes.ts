import * as Effect from 'effect/Effect';

import { ApiDaemonFiles } from '../../services/ApiDaemonFiles.js';
import { AppConfig } from '../../services/AppConfig.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { PluginServerFiles } from '../../services/PluginServerFiles.js';
import { Process } from '../../services/Process.js';
import { StatusLineFile } from '../../services/StatusLineFile.js';
import { SupervisorState } from '../../services/SupervisorState.js';
import { UserConfigFile } from '../../services/UserConfigFile.js';
import { resolveManagedStateFile } from '../managedRuntimePaths.js';
import { isTrustedPidRecord } from '../pidTrust.js';
import { cleanupStatuslineArtifacts, resolveStatuslineArtifactPaths } from '../statuslineArtifacts.js';
import type { DoctorFix, DoctorRestartSummary } from './types.js';

export function applyDoctorFixes(): Effect.Effect<
  { readonly fixes: readonly DoctorFix[]; readonly changed: boolean; readonly restartSummary: DoctorRestartSummary },
  never,
  AppConfig | DaemonFiles | ApiDaemonFiles | PluginServerFiles | SupervisorState | Process | UserConfigFile | StatusLineFile
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

    const restartSummary: DoctorRestartSummary = {
      attempted: [],
      restarted: [],
      skipped: ['safe_restart_disabled'],
      failed: [],
    };

    fixes.push({
      id: 'runtime.restart_mismatched_services',
      ok: true,
      changed: false,
      summary: 'Skipped automatic runtime restart inside doctor --fix to preserve the safe repair boundary',
      details: restartSummary,
    });

    return { fixes, changed, restartSummary };
  });
}
