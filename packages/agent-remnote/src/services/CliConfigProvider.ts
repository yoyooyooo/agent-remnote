import * as ConfigProvider from 'effect/ConfigProvider';

function normalizeBooleanValue(raw: string | undefined): string | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!v) return null;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return 'true';
  if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return 'false';
  return null;
}

export function buildCliEnvConfigProvider(params: {
  readonly cli: ReadonlyMap<string, string>;
  readonly env: NodeJS.ProcessEnv;
}): ConfigProvider.ConfigProvider {
  const map = new Map<string, string>();

  const env = params.env;

  const envStoreDb = env.REMNOTE_STORE_DB || env.STORE_DB;
  if (typeof envStoreDb === 'string' && envStoreDb.trim()) {
    map.set('storeDb', envStoreDb);
  } else {
    const envQueueDb = env.REMNOTE_QUEUE_DB || env.QUEUE_DB;
    if (typeof envQueueDb === 'string' && envQueueDb.trim()) map.set('storeDb', envQueueDb);
  }

  const envDaemonUrl = env.REMNOTE_DAEMON_URL || env.DAEMON_URL;
  if (typeof envDaemonUrl === 'string' && envDaemonUrl.trim()) map.set('daemonUrl', envDaemonUrl);

  const envWsPort = env.REMNOTE_WS_PORT || env.WS_PORT;
  if (typeof envWsPort === 'string' && envWsPort.trim()) map.set('wsPort', envWsPort);

  const envRemnoteDb = env.REMNOTE_DB;
  if (typeof envRemnoteDb === 'string' && envRemnoteDb.trim()) map.set('remnoteDb', envRemnoteDb);

  const envRepo = env.REMNOTE_REPO || env.AGENT_REMNOTE_REPO;
  if (typeof envRepo === 'string' && envRepo.trim()) map.set('repo', envRepo);

  const envWsStateFile = env.REMNOTE_WS_STATE_FILE || env.WS_STATE_FILE;
  if (typeof envWsStateFile === 'string' && envWsStateFile.trim()) map.set('wsStateFile', envWsStateFile);

  const envWsStateStaleMs = env.REMNOTE_WS_STATE_STALE_MS || env.WS_STATE_STALE_MS;
  if (typeof envWsStateStaleMs === 'string' && envWsStateStaleMs.trim()) map.set('wsStateStaleMs', envWsStateStaleMs);

  const envTmuxRefresh = normalizeBooleanValue(env.REMNOTE_TMUX_REFRESH);
  if (envTmuxRefresh !== null) map.set('tmuxRefresh', envTmuxRefresh);

  const envTmuxRefreshMinIntervalMs = env.REMNOTE_TMUX_REFRESH_MIN_INTERVAL_MS;
  if (typeof envTmuxRefreshMinIntervalMs === 'string' && envTmuxRefreshMinIntervalMs.trim()) {
    map.set('tmuxRefreshMinIntervalMs', envTmuxRefreshMinIntervalMs);
  }

  const envStatusLineFile = env.REMNOTE_STATUS_LINE_FILE;
  if (typeof envStatusLineFile === 'string' && envStatusLineFile.trim()) map.set('statusLineFile', envStatusLineFile);

  const envStatusLineMinIntervalMs = env.REMNOTE_STATUS_LINE_MIN_INTERVAL_MS;
  if (typeof envStatusLineMinIntervalMs === 'string' && envStatusLineMinIntervalMs.trim()) {
    map.set('statusLineMinIntervalMs', envStatusLineMinIntervalMs);
  }

  const envStatusLineDebug = normalizeBooleanValue(env.REMNOTE_STATUS_LINE_DEBUG);
  if (envStatusLineDebug !== null) map.set('statusLineDebug', envStatusLineDebug);

  const envStatusLineJsonFile = env.REMNOTE_STATUS_LINE_JSON_FILE;
  if (typeof envStatusLineJsonFile === 'string' && envStatusLineJsonFile.trim()) {
    map.set('statusLineJsonFile', envStatusLineJsonFile);
  }

  const envWsScheduler = normalizeBooleanValue(env.REMNOTE_WS_SCHEDULER);
  if (envWsScheduler !== null) map.set('wsScheduler', envWsScheduler);

  const envWsDispatchMaxBytes = env.REMNOTE_WS_DISPATCH_MAX_BYTES;
  if (typeof envWsDispatchMaxBytes === 'string' && envWsDispatchMaxBytes.trim()) {
    map.set('wsDispatchMaxBytes', envWsDispatchMaxBytes);
  }

  const envWsDispatchMaxOpBytes = env.REMNOTE_WS_DISPATCH_MAX_OP_BYTES;
  if (typeof envWsDispatchMaxOpBytes === 'string' && envWsDispatchMaxOpBytes.trim()) {
    map.set('wsDispatchMaxOpBytes', envWsDispatchMaxOpBytes);
  }

  // CLI flags override env
  for (const [k, v] of params.cli.entries()) {
    map.set(k, v);
  }

  return ConfigProvider.fromMap(map);
}
