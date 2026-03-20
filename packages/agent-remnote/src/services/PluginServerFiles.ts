import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CliError, isCliError } from './Errors.js';
import { homeDir, resolveUserFilePath } from '../lib/paths.js';
import type { RuntimeBuildInfo } from '../lib/runtimeBuildInfo.js';

export type PluginServerPidFile = {
  readonly pid: number;
  readonly build?: RuntimeBuildInfo | undefined;
  readonly started_at?: number | undefined;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly log_file?: string | undefined;
  readonly state_file?: string | undefined;
  readonly cmd?: readonly string[] | undefined;
};

export type PluginServerStateFile = {
  readonly running: boolean;
  readonly pid: number;
  readonly build?: RuntimeBuildInfo | undefined;
  readonly plugin_build?: RuntimeBuildInfo | undefined;
  readonly host: string;
  readonly port: number;
  readonly startedAt: number;
  readonly localBaseUrl: string;
  readonly distPath: string;
};

export interface PluginServerFilesService {
  readonly defaultPidFile: () => string;
  readonly defaultLogFile: () => string;
  readonly defaultStateFile: () => string;
  readonly readPidFile: (pidFilePath: string) => Effect.Effect<PluginServerPidFile | undefined, CliError>;
  readonly writePidFile: (pidFilePath: string, value: PluginServerPidFile) => Effect.Effect<void, CliError>;
  readonly deletePidFile: (pidFilePath: string) => Effect.Effect<void, CliError>;
  readonly readStateFile: (stateFilePath: string) => Effect.Effect<PluginServerStateFile | undefined, CliError>;
  readonly writeStateFile: (stateFilePath: string, value: PluginServerStateFile) => Effect.Effect<void, CliError>;
  readonly deleteStateFile: (stateFilePath: string) => Effect.Effect<void, CliError>;
}

export class PluginServerFiles extends Context.Tag('PluginServerFiles')<PluginServerFiles, PluginServerFilesService>() {}

function ensureDir(p: string): Promise<void> {
  return fs.mkdir(path.dirname(p), { recursive: true }).then(() => undefined);
}

function defaultPidFile(): string {
  const envPidFile = process.env.REMNOTE_PLUGIN_SERVER_PID_FILE;
  if (typeof envPidFile === 'string' && envPidFile.trim()) return resolveUserFilePath(envPidFile);
  return path.join(homeDir(), '.agent-remnote', 'plugin-server.pid');
}

function defaultLogFile(): string {
  const envLogFile = process.env.REMNOTE_PLUGIN_SERVER_LOG_FILE;
  if (typeof envLogFile === 'string' && envLogFile.trim()) return resolveUserFilePath(envLogFile);
  return path.join(homeDir(), '.agent-remnote', 'plugin-server.log');
}

function defaultStateFile(): string {
  const envStateFile = process.env.REMNOTE_PLUGIN_SERVER_STATE_FILE;
  if (typeof envStateFile === 'string' && envStateFile.trim()) return resolveUserFilePath(envStateFile);
  return path.join(homeDir(), '.agent-remnote', 'plugin-server.state.json');
}

function parseJson<T>(raw: string, filePath: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new CliError({
      code: 'INTERNAL',
      message: `Failed to parse JSON file: ${filePath}`,
      exitCode: 1,
      details: { file_path: filePath, error: String((error as any)?.message || error) },
    });
  }
}

export const PluginServerFilesLive = Layer.succeed(PluginServerFiles, {
  defaultPidFile,
  defaultLogFile,
  defaultStateFile,
  readPidFile: (pidFilePath) =>
    Effect.tryPromise({
      try: async () => {
        const resolved = resolveUserFilePath(pidFilePath);
        const raw = await fs.readFile(resolved, 'utf8');
        return parseJson<PluginServerPidFile>(raw, resolved);
      },
      catch: (error) => {
        const code = (error as any)?.code;
        if (code === 'ENOENT') return undefined as any;
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to read plugin server pid file',
          exitCode: 1,
          details: { file_path: pidFilePath, error: String((error as any)?.message || error) },
        });
      },
    }).pipe(
      Effect.catchAll((error) => {
        if (error === undefined) return Effect.succeed(undefined);
        return Effect.fail(error as CliError);
      }),
    ),
  writePidFile: (pidFilePath, value) =>
    Effect.tryPromise({
      try: async () => {
        const resolved = resolveUserFilePath(pidFilePath);
        await ensureDir(resolved);
        await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      },
      catch: (error) =>
        new CliError({
          code: 'INTERNAL',
          message: 'Failed to write plugin server pid file',
          exitCode: 1,
          details: { file_path: pidFilePath, error: String((error as any)?.message || error) },
        }),
    }),
  deletePidFile: (pidFilePath) =>
    Effect.tryPromise({
      try: async () => {
        const resolved = resolveUserFilePath(pidFilePath);
        await fs.rm(resolved, { force: true });
      },
      catch: (error) =>
        new CliError({
          code: 'INTERNAL',
          message: 'Failed to delete plugin server pid file',
          exitCode: 1,
          details: { file_path: pidFilePath, error: String((error as any)?.message || error) },
        }),
    }),
  readStateFile: (stateFilePath) =>
    Effect.tryPromise({
      try: async () => {
        const resolved = resolveUserFilePath(stateFilePath);
        const raw = await fs.readFile(resolved, 'utf8');
        return parseJson<PluginServerStateFile>(raw, resolved);
      },
      catch: (error) => {
        const code = (error as any)?.code;
        if (code === 'ENOENT') return undefined as any;
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to read plugin server state file',
          exitCode: 1,
          details: { file_path: stateFilePath, error: String((error as any)?.message || error) },
        });
      },
    }).pipe(
      Effect.catchAll((error) => {
        if (error === undefined) return Effect.succeed(undefined);
        return Effect.fail(error as CliError);
      }),
    ),
  writeStateFile: (stateFilePath, value) =>
    Effect.tryPromise({
      try: async () => {
        const resolved = resolveUserFilePath(stateFilePath);
        await ensureDir(resolved);
        await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      },
      catch: (error) =>
        new CliError({
          code: 'INTERNAL',
          message: 'Failed to write plugin server state file',
          exitCode: 1,
          details: { file_path: stateFilePath, error: String((error as any)?.message || error) },
        }),
    }),
  deleteStateFile: (stateFilePath) =>
    Effect.tryPromise({
      try: async () => {
        const resolved = resolveUserFilePath(stateFilePath);
        await fs.rm(resolved, { force: true });
      },
      catch: (error) =>
        new CliError({
          code: 'INTERNAL',
          message: 'Failed to delete plugin server state file',
          exitCode: 1,
          details: { file_path: stateFilePath, error: String((error as any)?.message || error) },
        }),
    }),
} satisfies PluginServerFilesService);
