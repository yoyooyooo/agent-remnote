import * as Effect from 'effect/Effect';
import path from 'node:path';

import { ApiDaemonFiles } from '../../services/ApiDaemonFiles.js';
import { AppConfig } from '../../services/AppConfig.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { FsAccess } from '../../services/FsAccess.js';
import { PluginServerFiles } from '../../services/PluginServerFiles.js';
import { Process } from '../../services/Process.js';
import { UserConfigFile } from '../../services/UserConfigFile.js';
import { getBuiltinScenarioPackage } from '../builtin-scenarios/index.js';
import { currentExpectedPluginBuildInfo } from '../pluginBuildInfo.js';
import { isTrustedPidRecord } from '../pidTrust.js';
import { resolvePluginDistPath, resolvePluginZipPath } from '../pluginArtifacts.js';
import { currentRuntimeBuildInfo } from '../runtimeBuildInfo.js';
import type { DoctorCheck } from './types.js';

type RuntimeArtifactDetail = {
  readonly service: 'daemon' | 'api' | 'plugin';
  readonly pidFile: string;
  readonly stateFile: string;
  readonly pid: number;
};

export function collectDoctorChecks(): Effect.Effect<
  readonly DoctorCheck[],
  never,
  AppConfig | DaemonFiles | ApiDaemonFiles | PluginServerFiles | Process | UserConfigFile | FsAccess
> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const daemonFiles = yield* DaemonFiles;
    const apiFiles = yield* ApiDaemonFiles;
    const pluginFiles = yield* PluginServerFiles;
    const userConfig = yield* UserConfigFile;
    const fsAccess = yield* FsAccess;

    const staleArtifacts: RuntimeArtifactDetail[] = [];

    const daemonPidFile = daemonFiles.defaultPidFile();
    const daemonPidInfo = yield* daemonFiles.readPidFile(daemonPidFile).pipe(Effect.orElseSucceed(() => undefined));
    if (daemonPidInfo?.pid && !(yield* isTrustedPidRecord(daemonPidInfo))) {
      staleArtifacts.push({
        service: 'daemon',
        pidFile: daemonPidFile,
        stateFile: daemonPidInfo.state_file ?? path.join(path.dirname(daemonPidFile), 'ws.state.json'),
        pid: daemonPidInfo.pid,
      });
    }

    const apiPidFile = apiFiles.defaultPidFile();
    const apiPidInfo = yield* apiFiles.readPidFile(apiPidFile).pipe(Effect.orElseSucceed(() => undefined));
    if (apiPidInfo?.pid && !(yield* isTrustedPidRecord(apiPidInfo))) {
      staleArtifacts.push({
        service: 'api',
        pidFile: apiPidFile,
        stateFile: apiPidInfo.state_file ?? apiFiles.defaultStateFile(),
        pid: apiPidInfo.pid,
      });
    }

    const pluginPidFile = pluginFiles.defaultPidFile();
    const pluginPidInfo = yield* pluginFiles.readPidFile(pluginPidFile).pipe(Effect.orElseSucceed(() => undefined));
    if (pluginPidInfo?.pid && !(yield* isTrustedPidRecord(pluginPidInfo))) {
      staleArtifacts.push({
        service: 'plugin',
        pidFile: pluginPidFile,
        stateFile: pluginPidInfo.state_file ?? pluginFiles.defaultStateFile(),
        pid: pluginPidInfo.pid,
      });
    }

    const current = currentRuntimeBuildInfo();
    const expectedPlugin = currentExpectedPluginBuildInfo();
    const mismatches = [
      daemonPidInfo?.build?.build_id && daemonPidInfo.build.build_id !== current.build_id ? { service: 'daemon', live: daemonPidInfo.build.build_id } : null,
      apiPidInfo?.build?.build_id && apiPidInfo.build.build_id !== current.build_id ? { service: 'api', live: apiPidInfo.build.build_id } : null,
      pluginPidInfo?.build?.build_id && pluginPidInfo.build.build_id !== current.build_id ? { service: 'plugin', live: pluginPidInfo.build.build_id } : null,
      expectedPlugin && pluginPidInfo?.build?.build_id && pluginPidInfo.build.build_id !== expectedPlugin.build_id
        ? { service: 'plugin-artifact', live: pluginPidInfo.build.build_id, expected: expectedPlugin.build_id }
        : null,
    ].filter(Boolean);

    const configPreview = yield* userConfig.previewRepair().pipe(Effect.either);
    const configChanged = configPreview._tag === 'Right' ? configPreview.right.changed : false;
    const configValid = configPreview._tag === 'Right' ? configPreview.right.before.valid : false;
    const configRepairable =
      configPreview._tag === 'Right' ? configPreview.right.before.valid && configPreview.right.changed : false;
    const configDetails = configPreview._tag === 'Right' ? configPreview.right : { error: configPreview.left.message };

    const packageCheck = yield* Effect.sync(() => {
      try {
        getBuiltinScenarioPackage('dn_recent_todos_to_today_move');
        getBuiltinScenarioPackage('dn_recent_todos_to_today_portal');
        return { ok: true, details: undefined };
      } catch (error) {
        return { ok: false, details: { error: String((error as any)?.message || error) } };
      }
    });

    const pluginArtifactsCheck = yield* Effect.sync(() => {
      try {
        return { ok: true, details: { distPath: resolvePluginDistPath(), zipPath: resolvePluginZipPath() } };
      } catch (error) {
        return { ok: false, details: { error: String((error as any)?.message || error) } };
      }
    });

    const pidWritable = yield* fsAccess.canWritePath(daemonPidFile);
    const logWritable = yield* fsAccess.canWritePath(daemonFiles.defaultLogFile());
    const storeWritable = yield* fsAccess.checkWritableFile(cfg.storeDb);
    const pathOk = pidWritable && logWritable && storeWritable.ok;

    return [
      {
        id: 'runtime.stale_pid_or_state',
        ok: staleArtifacts.length === 0,
        severity: staleArtifacts.length === 0 ? 'info' : 'warning',
        summary: staleArtifacts.length === 0 ? 'No stale runtime pid/state artifacts' : `Found ${staleArtifacts.length} stale runtime artifact set(s)`,
        details: staleArtifacts,
        repairable: staleArtifacts.length > 0,
      },
      {
        id: 'runtime.version_mismatch',
        ok: mismatches.length === 0,
        severity: mismatches.length === 0 ? 'info' : 'warning',
        summary: mismatches.length === 0 ? 'No runtime build mismatch detected' : `Found ${mismatches.length} runtime build mismatch(es)`,
        details: mismatches,
        repairable: mismatches.length > 0,
      },
      {
        id: 'config.migration_needed',
        ok: configValid && !configChanged,
        severity: !configValid ? 'error' : configChanged ? 'warning' : 'info',
        summary: !configValid
          ? 'User config is invalid or conflicting'
          : configChanged
            ? 'User config can be canonicalized'
            : 'User config already canonical',
        details: configDetails,
        repairable: configRepairable,
      },
      {
        id: 'package.builtin_scenarios_broken',
        ok: packageCheck.ok,
        severity: packageCheck.ok ? 'info' : 'error',
        summary: packageCheck.ok ? 'Builtin scenarios are loadable' : 'Builtin scenario package loading failed',
        details: packageCheck.details,
        repairable: !packageCheck.ok,
      },
      {
        id: 'package.plugin_artifacts_unavailable',
        ok: pluginArtifactsCheck.ok,
        severity: pluginArtifactsCheck.ok ? 'info' : 'error',
        summary: pluginArtifactsCheck.ok ? 'Plugin artifacts are available' : 'Plugin artifacts are unavailable',
        details: pluginArtifactsCheck.details,
        repairable: false,
      },
      {
        id: 'env.path_or_permission_problem',
        ok: pathOk,
        severity: pathOk ? 'info' : 'error',
        summary: pathOk ? 'Required writable paths are available' : 'One or more required paths are not writable',
        details: {
          daemon_pid_file: daemonPidFile,
          daemon_log_file: daemonFiles.defaultLogFile(),
          pid_writable: pidWritable,
          log_writable: logWritable,
          store_db: cfg.storeDb,
          store_writable: storeWritable,
        },
        repairable: false,
      },
    ] satisfies readonly DoctorCheck[];
  });
}
