import * as Config from 'effect/Config';
import * as ConfigError from 'effect/ConfigError';
import * as Effect from 'effect/Effect';
import fs from 'node:fs';
import path from 'node:path';

import { CliError, isCliError } from './Errors.js';
import { homeDir, resolveUserFilePath } from '../lib/paths.js';
import { pickClient, readJson } from '../lib/wsState.js';
import { remnoteDbPathForWorkspaceId } from '../lib/remnote.js';

export type OutputFormat = 'json' | 'md' | 'ids';

export type ResolvedConfig = {
  readonly format: OutputFormat;
  readonly quiet: boolean;
  readonly debug: boolean;
  readonly configFile: string;
  readonly remnoteDb: string | undefined;
  readonly storeDb: string;
  readonly wsUrl: string;
  readonly wsScheduler: boolean;
  readonly wsDispatchMaxBytes: number;
  readonly wsDispatchMaxOpBytes: number;
  readonly repo: string | undefined;
  readonly wsStateFile: { readonly disabled: boolean; readonly path: string };
  readonly wsStateStaleMs: number;
  readonly tmuxRefresh: boolean;
  readonly tmuxRefreshMinIntervalMs: number;
  readonly statusLineFile: string;
  readonly statusLineMinIntervalMs: number;
  readonly statusLineDebug: boolean;
  readonly statusLineJsonFile: string;
  readonly apiBaseUrl?: string | undefined;
  readonly apiHost?: string | undefined;
  readonly apiPort?: number | undefined;
  readonly apiBasePath?: string | undefined;
  readonly apiPidFile?: string | undefined;
  readonly apiLogFile?: string | undefined;
  readonly apiStateFile?: string | undefined;
};

type RawConfig = {
  readonly json: boolean;
  readonly md: boolean;
  readonly ids: boolean;
  readonly quiet: boolean;
  readonly debug: boolean;
  readonly configFile: string;
  readonly remnoteDb: string;
  readonly storeDb: string;
  readonly daemonUrl: string;
  readonly wsPort: number;
  readonly wsScheduler: boolean;
  readonly wsDispatchMaxBytes: number;
  readonly wsDispatchMaxOpBytes: number;
  readonly repo: string;
  readonly wsStateFile: string;
  readonly wsStateStaleMs: number;
  readonly tmuxRefresh: boolean;
  readonly tmuxRefreshMinIntervalMs: number;
  readonly statusLineFile: string;
  readonly statusLineMinIntervalMs: number;
  readonly statusLineDebug: boolean;
  readonly statusLineJsonFile: string;
  readonly apiBaseUrl: string;
  readonly apiHost?: string | undefined;
  readonly apiPort?: number | undefined;
  readonly apiBasePath?: string | undefined;
  readonly apiPidFile?: string | undefined;
  readonly apiLogFile?: string | undefined;
  readonly apiStateFile?: string | undefined;
};

function defaultStoreDbPath(): string {
  return path.join(homeDir(), '.agent-remnote', 'store.sqlite');
}

function defaultUserConfigFilePath(): string {
  return path.join(homeDir(), '.agent-remnote', 'config.json');
}

function wsUrlFromPort(port: number): string {
  return `ws://localhost:${port}/ws`;
}

function defaultWsStateFilePath(): string {
  return path.join(homeDir(), '.agent-remnote', 'ws.bridge.state.json');
}

function defaultStatusLineFilePath(): string {
  return path.join(homeDir(), '.agent-remnote', 'status-line.txt');
}

function defaultStatusLineJsonFilePath(): string {
  return path.join(homeDir(), '.agent-remnote', 'status-line.json');
}

function defaultApiPidFilePath(): string {
  return path.join(homeDir(), '.agent-remnote', 'api.pid');
}

function defaultApiLogFilePath(): string {
  return path.join(homeDir(), '.agent-remnote', 'api.log');
}

function defaultApiStateFilePath(): string {
  return path.join(homeDir(), '.agent-remnote', 'api.state.json');
}

const ROOT_BOOL_FLAGS = new Set(['--json', '--md', '--ids', '--quiet', '--debug']);
const BUILTIN_BOOL_FLAGS = new Set(['--help', '-h', '--wizard', '--version']);
const BUILTIN_VALUE_FLAGS = new Set(['--completions', '--log-level']);
const ROOT_VALUE_FLAGS = new Set([
  '--remnote-db',
  '--store-db',
  '--daemon-url',
  '--ws-port',
  '--repo',
  '--api-base-url',
  '--api-host',
  '--api-port',
  '--api-base-path',
  '--config-file',
  ...BUILTIN_VALUE_FLAGS,
]);

function isBooleanLiteralToken(token: string): boolean {
  const v = token.trim().toLowerCase();
  return v === 'true' || v === 'false';
}

function splitFlagInlineValue(token: string): { readonly flag: string; readonly inlineValue: string | null } {
  if (!token.startsWith('--')) return { flag: token, inlineValue: null };
  const eq = token.indexOf('=');
  if (eq === -1) return { flag: token, inlineValue: null };
  return { flag: token.slice(0, eq), inlineValue: token.slice(eq + 1) };
}

function isConfigCommandInvocation(argv: readonly string[]): boolean {
  const tokens = argv.slice(2);
  let i = 0;
  while (i < tokens.length) {
    const raw = String(tokens[i] ?? '');
    if (!raw) break;
    if (raw === '--') {
      i += 1;
      break;
    }
    if (!raw.startsWith('-')) break;

    const { flag, inlineValue } = splitFlagInlineValue(raw);

    if (ROOT_VALUE_FLAGS.has(flag)) {
      i += inlineValue !== null ? 1 : 2;
      continue;
    }

    if (ROOT_BOOL_FLAGS.has(flag) || BUILTIN_BOOL_FLAGS.has(flag)) {
      if (inlineValue !== null) {
        i += 1;
        continue;
      }
      const next = tokens[i + 1];
      if (typeof next === 'string' && isBooleanLiteralToken(next)) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    break;
  }
  return tokens[i] === 'config';
}

export function normalizeApiBasePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '/v1';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function normalizeApiHost(raw: string): string {
  const trimmed = raw.trim();
  return trimmed || '0.0.0.0';
}

export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `Invalid apiBaseUrl: ${trimmed}`,
      exitCode: 2,
      details: { api_base_url: trimmed },
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `apiBaseUrl protocol must be http/https: ${trimmed}`,
      exitCode: 2,
      details: { api_base_url: trimmed },
    });
  }
  const normalized = trimmed.replace(/\/+$/, '');
  return normalized;
}

export function normalizeApiPort(raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `Invalid apiPort: ${String(raw)}`,
      exitCode: 2,
      details: { api_port: raw },
    });
  }
  return value;
}

function resolveWsStateFile(spec: string): { readonly disabled: boolean; readonly path: string } {
  const raw = spec.trim();
  if (raw === '0' || raw.toLowerCase() === 'false') {
    return { disabled: true, path: defaultWsStateFilePath() };
  }
  if (raw) return { disabled: false, path: resolveUserFilePath(raw) };
  return { disabled: false, path: defaultWsStateFilePath() };
}

function inferRemnoteDbFromWsState(params: {
  readonly wsStateFile: { readonly disabled: boolean; readonly path: string };
  readonly wsStateStaleMs: number;
}): string | undefined {
  if (params.wsStateFile.disabled) return undefined;

  const state = readJson(params.wsStateFile.path);
  if (!state) return undefined;

  const now = Date.now();
  const updatedAt = Number(state.updatedAt ?? 0);
  const staleMs = params.wsStateStaleMs;
  const stale = !Number.isFinite(updatedAt) || updatedAt <= 0 || now - updatedAt > staleMs;
  if (stale) return undefined;

  const clients = Array.isArray(state.clients) ? state.clients : [];
  const activeConnIdRaw = typeof state.activeWorkerConnId === 'string' ? state.activeWorkerConnId.trim() : '';
  const client = pickClient(clients, activeConnIdRaw || undefined);
  const kbIdRaw = typeof client?.uiContext?.kbId === 'string' ? client.uiContext.kbId.trim() : '';
  if (!kbIdRaw) return undefined;

  const dbPath = resolveUserFilePath(remnoteDbPathForWorkspaceId(kbIdRaw));
  try {
    return fs.statSync(dbPath).isFile() ? dbPath : undefined;
  } catch {
    return undefined;
  }
}

function pickFormat(raw: Pick<RawConfig, 'json' | 'md' | 'ids'>): OutputFormat {
  const json = raw.json === true;
  const md = raw.md === true;
  const ids = raw.ids === true;
  const count = [json, md, ids].filter(Boolean).length;
  if (count > 1) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: 'Output format conflict: choose only one of --json/--md/--ids',
      exitCode: 2,
      details: { json, md, ids },
    });
  }
  if (json) return 'json';
  if (ids) return 'ids';
  return 'md';
}

const rawConfigSpec = Config.all({
  json: Config.boolean('json').pipe(Config.withDefault(false)),
  md: Config.boolean('md').pipe(Config.withDefault(false)),
  ids: Config.boolean('ids').pipe(Config.withDefault(false)),
  quiet: Config.boolean('quiet').pipe(Config.withDefault(false)),
  debug: Config.boolean('debug').pipe(Config.withDefault(false)),
  configFile: Config.string('configFile').pipe(Config.withDefault(defaultUserConfigFilePath())),

  remnoteDb: Config.string('remnoteDb').pipe(Config.withDefault('')),
  storeDb: Config.string('storeDb').pipe(Config.withDefault(defaultStoreDbPath())),
  daemonUrl: Config.string('daemonUrl').pipe(Config.withDefault('')),
  wsPort: Config.port('wsPort').pipe(Config.withDefault(6789)),
  wsScheduler: Config.boolean('wsScheduler').pipe(Config.withDefault(true)),
  wsDispatchMaxBytes: Config.integer('wsDispatchMaxBytes').pipe(
    Config.withDefault(512_000),
    Config.validate({
      message: 'wsDispatchMaxBytes must be a positive integer',
      validation: (n) => Number.isFinite(n) && n > 0,
    }),
  ),
  wsDispatchMaxOpBytes: Config.integer('wsDispatchMaxOpBytes').pipe(
    Config.withDefault(256_000),
    Config.validate({
      message: 'wsDispatchMaxOpBytes must be a positive integer',
      validation: (n) => Number.isFinite(n) && n > 0,
    }),
  ),
  repo: Config.string('repo').pipe(Config.withDefault('')),

  wsStateFile: Config.string('wsStateFile').pipe(Config.withDefault('')),
  wsStateStaleMs: Config.integer('wsStateStaleMs').pipe(
    Config.withDefault(60_000),
    Config.validate({
      message: 'wsStateStaleMs must be a positive integer',
      validation: (n) => Number.isFinite(n) && n > 0,
    }),
  ),

  tmuxRefresh: Config.boolean('tmuxRefresh').pipe(Config.withDefault(true)),
  tmuxRefreshMinIntervalMs: Config.integer('tmuxRefreshMinIntervalMs').pipe(
    Config.withDefault(250),
    Config.validate({
      message: 'tmuxRefreshMinIntervalMs must be a positive integer',
      validation: (n) => Number.isFinite(n) && n > 0,
    }),
  ),

  statusLineFile: Config.string('statusLineFile').pipe(Config.withDefault(defaultStatusLineFilePath())),
  statusLineMinIntervalMs: Config.integer('statusLineMinIntervalMs').pipe(
    Config.withDefault(250),
    Config.validate({
      message: 'statusLineMinIntervalMs must be a positive integer',
      validation: (n) => Number.isFinite(n) && n > 0,
    }),
  ),
  statusLineDebug: Config.boolean('statusLineDebug').pipe(Config.withDefault(false)),
  statusLineJsonFile: Config.string('statusLineJsonFile').pipe(Config.withDefault(defaultStatusLineJsonFilePath())),

  apiBaseUrl: Config.string('apiBaseUrl').pipe(Config.withDefault('')),
  apiHost: Config.string('apiHost').pipe(Config.withDefault('')),
  apiPort: Config.integer('apiPort').pipe(
    Config.withDefault(-1),
    Config.validate({
      message: 'apiPort must be -1 or a valid port',
      validation: (n) => Number.isInteger(n) && (n === -1 || (n > 0 && n <= 65535)),
    }),
  ),
  apiBasePath: Config.string('apiBasePath').pipe(Config.withDefault('')),
  apiPidFile: Config.string('apiPidFile').pipe(Config.withDefault(defaultApiPidFilePath())),
  apiLogFile: Config.string('apiLogFile').pipe(Config.withDefault(defaultApiLogFilePath())),
  apiStateFile: Config.string('apiStateFile').pipe(Config.withDefault(defaultApiStateFilePath())),
}) satisfies Config.Config<RawConfig>;

function cliErrorFromConfigError(error: ConfigError.ConfigError): CliError {
  if (ConfigError.isInvalidData(error) || ConfigError.isMissingData(error)) {
    return new CliError({
      code: 'INVALID_ARGS',
      message: error.message || 'Invalid configuration',
      exitCode: 2,
      details: { path: error.path, op: error._op },
    });
  }
  return new CliError({
    code: 'INVALID_ARGS',
    message: error.message || 'Invalid configuration',
    exitCode: 2,
    details: { op: error._op },
  });
}

function optionalTrimmed(s: string): string | undefined {
  const t = s.trim();
  return t.length > 0 ? t : undefined;
}

function readUserConfigFile(configFile: string): {
  readonly apiBaseUrl?: string | undefined;
  readonly apiHost?: string | undefined;
  readonly apiPort?: number | undefined;
  readonly apiBasePath?: string | undefined;
} {
  const file = resolveUserFilePath(configFile);

  let rawText = '';
  try {
    rawText = fs.readFileSync(file, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `Failed to read config file: ${file}`,
      exitCode: 2,
      details: { config_file: file, error: String(error?.message || error) },
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error: any) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `Invalid JSON in config file: ${file}`,
      exitCode: 2,
      details: { config_file: file, error: String(error?.message || error) },
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `Config file must contain a JSON object: ${file}`,
      exitCode: 2,
      details: { config_file: file },
    });
  }

  const config = parsed as Record<string, unknown>;
  const api = config.api;
  const apiObject =
    api && typeof api === 'object' && !Array.isArray(api) ? (api as Record<string, unknown>) : undefined;
  const nestedBaseUrl = apiObject?.baseUrl;
  const nestedHost = apiObject?.host;
  const nestedPort = apiObject?.port;
  const nestedBasePath = apiObject?.basePath;

  const apiBaseUrl = config.apiBaseUrl ?? nestedBaseUrl;
  const apiHostRaw = config.apiHost ?? nestedHost;
  const apiPortRaw = config.apiPort ?? nestedPort;
  const apiBasePathRaw = config.apiBasePath ?? nestedBasePath;

  if (apiBaseUrl !== undefined && typeof apiBaseUrl !== 'string') {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: `Config key apiBaseUrl must be a string: ${file}`,
      exitCode: 2,
      details: { config_file: file },
    });
  }

  const apiHost =
    apiHostRaw === undefined
      ? undefined
      : (() => {
          if (typeof apiHostRaw !== 'string') {
            throw new CliError({
              code: 'INVALID_ARGS',
              message: `Config key apiHost must be a string: ${file}`,
              exitCode: 2,
              details: { config_file: file },
            });
          }
          return normalizeApiHost(apiHostRaw);
        })();

  const apiPort =
    apiPortRaw === undefined
      ? undefined
      : (() => {
          if (typeof apiPortRaw !== 'number' && typeof apiPortRaw !== 'string') {
            throw new CliError({
              code: 'INVALID_ARGS',
              message: `Config key apiPort must be a valid port number: ${file}`,
              exitCode: 2,
              details: { config_file: file },
            });
          }
          return normalizeApiPort(apiPortRaw);
        })();

  const apiBasePath =
    apiBasePathRaw === undefined
      ? undefined
      : (() => {
          if (typeof apiBasePathRaw !== 'string') {
            throw new CliError({
              code: 'INVALID_ARGS',
              message: `Config key apiBasePath must be a string: ${file}`,
              exitCode: 2,
              details: { config_file: file },
            });
          }
          return normalizeApiBasePath(apiBasePathRaw);
        })();

  if (apiBaseUrl === undefined && apiHost === undefined && apiPort === undefined && apiBasePath === undefined) {
    return {};
  }

  return { apiBaseUrl, apiHost, apiPort, apiBasePath };
}

export function resolveConfig(): Effect.Effect<ResolvedConfig, CliError> {
  return Effect.gen(function* () {
    const raw = yield* rawConfigSpec;
    const configFile = resolveUserFilePath(raw.configFile);
    const userConfigResult = yield* Effect.either(
      Effect.try({
        try: () => readUserConfigFile(configFile),
        catch: (error) =>
          isCliError(error)
            ? error
            : new CliError({
                code: 'INVALID_ARGS',
                message: `Failed to load config file: ${configFile}`,
                exitCode: 2,
                details: { config_file: configFile, error: String((error as any)?.message || error) },
              }),
      }),
    );
    const userConfig =
      userConfigResult._tag === 'Right'
        ? userConfigResult.right
        : isConfigCommandInvocation(process.argv)
          ? {}
          : yield* Effect.fail(userConfigResult.left);

    const wsStateFile = resolveWsStateFile(raw.wsStateFile);

    const remnoteDb = optionalTrimmed(raw.remnoteDb)
      ? resolveUserFilePath(raw.remnoteDb)
      : inferRemnoteDbFromWsState({ wsStateFile, wsStateStaleMs: raw.wsStateStaleMs }) || undefined;

    const storeDb = resolveUserFilePath(raw.storeDb);

    const daemonUrl = optionalTrimmed(raw.daemonUrl);
    const wsUrl = daemonUrl ? daemonUrl : wsUrlFromPort(raw.wsPort);

    const format = yield* Effect.try({
      try: () => pickFormat(raw),
      catch: (e) =>
        isCliError(e)
          ? e
          : new CliError({
              code: 'INVALID_ARGS',
              message: 'Invalid output format flags',
              exitCode: 2,
              details: { error: String((e as any)?.message || e) },
            }),
    });

    const apiBaseUrlRaw = optionalTrimmed(raw.apiBaseUrl) ?? optionalTrimmed(userConfig.apiBaseUrl ?? '');
    const apiBaseUrl = apiBaseUrlRaw ? normalizeApiBaseUrl(apiBaseUrlRaw) : undefined;
    const apiHostRaw = optionalTrimmed(raw.apiHost ?? '') ?? optionalTrimmed(userConfig.apiHost ?? '') ?? '0.0.0.0';
    const apiHost = normalizeApiHost(apiHostRaw);
    const apiPort = raw.apiPort && raw.apiPort > 0 ? raw.apiPort : (userConfig.apiPort ?? 3000);
    const apiBasePathRaw =
      optionalTrimmed(raw.apiBasePath ?? '') ?? optionalTrimmed(userConfig.apiBasePath ?? '') ?? '/v1';
    const apiBasePath = normalizeApiBasePath(apiBasePathRaw);

    return {
      format,
      quiet: raw.quiet,
      debug: raw.debug,
      configFile,
      remnoteDb,
      storeDb,
      wsUrl,
      wsScheduler: raw.wsScheduler,
      wsDispatchMaxBytes: raw.wsDispatchMaxBytes,
      wsDispatchMaxOpBytes: raw.wsDispatchMaxOpBytes,
      repo: optionalTrimmed(raw.repo) ? resolveUserFilePath(raw.repo) : undefined,
      wsStateFile,
      wsStateStaleMs: raw.wsStateStaleMs,
      tmuxRefresh: raw.tmuxRefresh,
      tmuxRefreshMinIntervalMs: raw.tmuxRefreshMinIntervalMs,
      statusLineFile: resolveUserFilePath(raw.statusLineFile),
      statusLineMinIntervalMs: raw.statusLineMinIntervalMs,
      statusLineDebug: raw.statusLineDebug,
      statusLineJsonFile: resolveUserFilePath(raw.statusLineJsonFile),
      apiBaseUrl,
      apiHost,
      apiPort,
      apiBasePath,
      apiPidFile: resolveUserFilePath(raw.apiPidFile),
      apiLogFile: resolveUserFilePath(raw.apiLogFile),
      apiStateFile: resolveUserFilePath(raw.apiStateFile),
    };
  }).pipe(
    Effect.catchAll((error) => {
      if (isCliError(error)) return Effect.fail(error);
      if (ConfigError.isConfigError(error)) return Effect.fail(cliErrorFromConfigError(error));
      return Effect.fail(
        new CliError({
          code: 'INTERNAL',
          message: 'Failed to parse config',
          exitCode: 1,
          details: { error: String((error as any)?.message || error) },
        }),
      );
    }),
  );
}
