import { Command } from '@effect/cli';
import * as Effect from 'effect/Effect';

import { AppConfig } from '../../services/AppConfig.js';
import { DaemonFiles } from '../../services/DaemonFiles.js';
import { SupervisorState } from '../../services/SupervisorState.js';
import { writeFailure, writeSuccess } from '../_shared.js';

export const configPrintCommand = Command.make('print', {}, () =>
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const daemonFiles = yield* DaemonFiles;
    const supervisorState = yield* SupervisorState;

    const daemonPidFile = daemonFiles.defaultPidFile();
    const daemonLogFile = daemonFiles.defaultLogFile();
    const supervisorStateFile = supervisorState.defaultStateFile();

    const data = {
      format: cfg.format,
      quiet: cfg.quiet,
      debug: cfg.debug,
      config_file: cfg.configFile,
      remnote_db: cfg.remnoteDb,
      store_db: cfg.storeDb,
      ws_url: cfg.wsUrl,
      ws_scheduler: cfg.wsScheduler,
      repo: cfg.repo,
      ws_bridge_state_file: cfg.wsStateFile.path,
      ws_bridge_state_file_disabled: cfg.wsStateFile.disabled,
      ws_bridge_state_stale_ms: cfg.wsStateStaleMs,
      tmux_refresh: cfg.tmuxRefresh,
      tmux_refresh_min_interval_ms: cfg.tmuxRefreshMinIntervalMs,
      status_line_file: cfg.statusLineFile,
      status_line_min_interval_ms: cfg.statusLineMinIntervalMs,
      status_line_debug: cfg.statusLineDebug,
      status_line_json_file: cfg.statusLineJsonFile,
      api_base_url: cfg.apiBaseUrl,
      api_host: cfg.apiHost,
      api_port: cfg.apiPort,
      api_base_path: cfg.apiBasePath,
      api_pid_file: cfg.apiPidFile,
      api_log_file: cfg.apiLogFile,
      api_state_file: cfg.apiStateFile,
      daemon_pid_file_default: daemonPidFile,
      daemon_log_file_default: daemonLogFile,
      supervisor_state_file_default: supervisorStateFile,
    };
    const md = [
      `- format: ${data.format}`,
      `- quiet: ${data.quiet}`,
      `- debug: ${data.debug}`,
      `- config_file: ${data.config_file}`,
      `- remnote_db: ${data.remnote_db ?? ''}`,
      `- store_db: ${data.store_db}`,
      `- ws_url: ${data.ws_url}`,
      `- ws_scheduler: ${data.ws_scheduler}`,
      `- repo: ${data.repo ?? ''}`,
      `- ws_bridge_state_file: ${data.ws_bridge_state_file}`,
      `- ws_bridge_state_file_disabled: ${data.ws_bridge_state_file_disabled}`,
      `- ws_bridge_state_stale_ms: ${data.ws_bridge_state_stale_ms}`,
      `- tmux_refresh: ${data.tmux_refresh}`,
      `- tmux_refresh_min_interval_ms: ${data.tmux_refresh_min_interval_ms}`,
      `- status_line_file: ${data.status_line_file}`,
      `- status_line_min_interval_ms: ${data.status_line_min_interval_ms}`,
      `- status_line_debug: ${data.status_line_debug}`,
      `- status_line_json_file: ${data.status_line_json_file}`,
      `- api_base_url: ${data.api_base_url ?? ''}`,
      `- api_host: ${data.api_host ?? ''}`,
      `- api_port: ${data.api_port ?? ''}`,
      `- api_base_path: ${data.api_base_path ?? ''}`,
      `- api_pid_file: ${data.api_pid_file ?? ''}`,
      `- api_log_file: ${data.api_log_file ?? ''}`,
      `- api_state_file: ${data.api_state_file ?? ''}`,
      `- daemon_pid_file_default: ${data.daemon_pid_file_default}`,
      `- daemon_log_file_default: ${data.daemon_log_file_default}`,
      `- supervisor_state_file_default: ${data.supervisor_state_file_default}`,
    ].join('\n');
    yield* writeSuccess({ data, md });
  }).pipe(Effect.catchAll(writeFailure)),
);
