import * as Effect from 'effect/Effect';
import path from 'node:path';

import { ApiDaemonFiles } from '../../services/ApiDaemonFiles.js';
import { AppConfig } from '../../services/AppConfig.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { PluginServerFiles } from '../../services/PluginServerFiles.js';
import { Process } from '../../services/Process.js';
import { StatusLineFile } from '../../services/StatusLineFile.js';
import { SupervisorState } from '../../services/SupervisorState.js';
import { UserConfigFile } from '../../services/UserConfigFile.js';
import { HostApiClient } from '../../services/HostApiClient.js';
import { WsClient } from '../../services/WsClient.js';
import { cleanupStatuslineArtifacts, resolveStatuslineArtifactPaths } from '../statuslineArtifacts.js';
import type { DoctorFix, DoctorRestartSummary } from './types.js';

export function applyDoctorFixes(): Effect.Effect<
  { readonly fixes: readonly DoctorFix[]; readonly changed: boolean; readonly restartSummary: DoctorRestartSummary },
  never,
  AppConfig | DaemonFiles | ApiDaemonFiles | PluginServerFiles | SupervisorState | Process | UserConfigFile | HostApiClient | WsClient | StatusLineFile
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

    const daemonPidFile = daemonFiles.defaultPidFile();
    const daemonPidInfo = yield* daemonFiles.readPidFile(daemonPidFile).pipe(Effect.orElseSucceed(() => undefined));
    if (daemonPidInfo?.pid && !(yield* proc.isPidRunning(daemonPidInfo.pid))) {
      yield* daemonFiles.deletePidFile(daemonPidFile).pipe(Effect.orElseSucceed(() => undefined));
      const daemonStateFile = supervisorState.defaultStateFile();
      yield* supervisorState.deleteStateFile(daemonStateFile).pipe(Effect.orElseSucceed(() => undefined));
      yield* cleanupStatuslineArtifacts(resolveStatuslineArtifactPaths({ cfg })).pipe(
        Effect.orElseSucceed(() => ({
          wsBridgeStateFile: { action: 'skipped', file: cfg.wsStateFile.path },
          statusLineFile: { action: 'skipped', file: cfg.statusLineFile },
          statusLineJsonFile: { action: 'skipped', file: cfg.statusLineJsonFile },
        })),
      );
      cleaned.push({ service: 'daemon', pidFile: daemonPidFile, stateFile: daemonStateFile, pid: daemonPidInfo.pid });
      changed = true;
    }

    const apiPidFile = apiFiles.defaultPidFile();
    const apiPidInfo = yield* apiFiles.readPidFile(apiPidFile).pipe(Effect.orElseSucceed(() => undefined));
    if (apiPidInfo?.pid && !(yield* proc.isPidRunning(apiPidInfo.pid))) {
      yield* apiFiles.deletePidFile(apiPidFile).pipe(Effect.orElseSucceed(() => undefined));
      const apiStateFile = apiFiles.defaultStateFile();
      yield* apiFiles.deleteStateFile(apiStateFile).pipe(Effect.orElseSucceed(() => undefined));
      cleaned.push({ service: 'api', pidFile: apiPidFile, stateFile: apiStateFile, pid: apiPidInfo.pid });
      changed = true;
    }

    const pluginPidFile = pluginFiles.defaultPidFile();
    const pluginPidInfo = yield* pluginFiles.readPidFile(pluginPidFile).pipe(Effect.orElseSucceed(() => undefined));
    if (pluginPidInfo?.pid && !(yield* proc.isPidRunning(pluginPidInfo.pid))) {
      yield* pluginFiles.deletePidFile(pluginPidFile).pipe(Effect.orElseSucceed(() => undefined));
      const pluginStateFile = pluginFiles.defaultStateFile();
      yield* pluginFiles.deleteStateFile(pluginStateFile).pipe(Effect.orElseSucceed(() => undefined));
      cleaned.push({ service: 'plugin', pidFile: pluginPidFile, stateFile: pluginStateFile, pid: pluginPidInfo.pid });
      changed = true;
    }

    fixes.push({
      id: 'runtime.cleanup_stale_artifacts',
      ok: true,
      changed: cleaned.length > 0,
      summary: cleaned.length > 0 ? `Cleaned ${cleaned.length} stale runtime artifact set(s)` : 'No stale runtime artifacts needed cleanup',
      details: cleaned,
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
