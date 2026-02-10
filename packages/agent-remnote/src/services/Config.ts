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
};

type RawConfig = {
  readonly json: boolean;
  readonly md: boolean;
  readonly ids: boolean;
  readonly quiet: boolean;
  readonly debug: boolean;
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
};

function defaultStoreDbPath(): string {
  return path.join(homeDir(), '.agent-remnote', 'store.sqlite');
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
  // Default output: md
  return 'md';
}

const rawConfigSpec = Config.all({
  json: Config.boolean('json').pipe(Config.withDefault(false)),
  md: Config.boolean('md').pipe(Config.withDefault(false)),
  ids: Config.boolean('ids').pipe(Config.withDefault(false)),
  quiet: Config.boolean('quiet').pipe(Config.withDefault(false)),
  debug: Config.boolean('debug').pipe(Config.withDefault(false)),

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
    Config.validate({ message: 'wsStateStaleMs must be a positive integer', validation: (n) => Number.isFinite(n) && n > 0 }),
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

export function resolveConfig(): Effect.Effect<ResolvedConfig, CliError> {
  return Effect.gen(function* () {
    const raw = yield* rawConfigSpec;

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

    return {
      format,
      quiet: raw.quiet,
      debug: raw.debug,
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
