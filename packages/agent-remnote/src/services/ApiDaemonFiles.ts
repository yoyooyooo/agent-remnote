import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CliError, isCliError } from './Errors.js';
import { homeDir, resolveUserFilePath } from '../lib/paths.js';

export type ApiPidFile = {
  readonly pid: number;
  readonly started_at?: number | undefined;
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly base_path?: string | undefined;
  readonly log_file?: string | undefined;
  readonly state_file?: string | undefined;
  readonly cmd?: readonly string[] | undefined;
};

export type ApiStateFile = {
  readonly running: boolean;
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  readonly basePath: string;
  readonly startedAt: number;
  readonly localBaseUrl: string;
  readonly containerBaseUrl: string;
  readonly daemon?: { readonly healthy: boolean; readonly wsUrl: string } | undefined;
};

export interface ApiDaemonFilesService {
  readonly defaultPidFile: () => string;
  readonly defaultLogFile: () => string;
  readonly defaultStateFile: () => string;
  readonly readPidFile: (pidFilePath: string) => Effect.Effect<ApiPidFile | undefined, CliError>;
  readonly writePidFile: (pidFilePath: string, value: ApiPidFile) => Effect.Effect<void, CliError>;
  readonly deletePidFile: (pidFilePath: string) => Effect.Effect<void, CliError>;
  readonly readStateFile: (stateFilePath: string) => Effect.Effect<ApiStateFile | undefined, CliError>;
  readonly writeStateFile: (stateFilePath: string, value: ApiStateFile) => Effect.Effect<void, CliError>;
  readonly deleteStateFile: (stateFilePath: string) => Effect.Effect<void, CliError>;
}

export class ApiDaemonFiles extends Context.Tag('ApiDaemonFiles')<ApiDaemonFiles, ApiDaemonFilesService>() {}

function ensureDir(p: string): Promise<void> {
  return fs.mkdir(path.dirname(p), { recursive: true }).then(() => undefined);
}

function defaultPidFile(): string {
  const envPidFile = process.env.REMNOTE_API_PID_FILE;
  if (typeof envPidFile === 'string' && envPidFile.trim()) return resolveUserFilePath(envPidFile);
  return path.join(homeDir(), '.agent-remnote', 'api.pid');
}

function defaultLogFile(): string {
  const envLogFile = process.env.REMNOTE_API_LOG_FILE;
  if (typeof envLogFile === 'string' && envLogFile.trim()) return resolveUserFilePath(envLogFile);
  return path.join(homeDir(), '.agent-remnote', 'api.log');
}

function defaultStateFile(): string {
  const envStateFile = process.env.REMNOTE_API_STATE_FILE;
  if (typeof envStateFile === 'string' && envStateFile.trim()) return resolveUserFilePath(envStateFile);
  return path.join(homeDir(), '.agent-remnote', 'api.state.json');
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

export const ApiDaemonFilesLive = Layer.succeed(ApiDaemonFiles, {
  defaultPidFile,
  defaultLogFile,
  defaultStateFile,
  readPidFile: (pidFilePath) =>
    Effect.tryPromise({
      try: async () => {
        const resolved = resolveUserFilePath(pidFilePath);
        const raw = await fs.readFile(resolved, 'utf8');
        return parseJson<ApiPidFile>(raw, resolved);
      },
      catch: (error) => {
        const code = (error as any)?.code;
        if (code === 'ENOENT') return undefined as any;
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to read api pid file',
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
          message: 'Failed to write api pid file',
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
          message: 'Failed to delete api pid file',
          exitCode: 1,
          details: { file_path: pidFilePath, error: String((error as any)?.message || error) },
        }),
    }),
  readStateFile: (stateFilePath) =>
    Effect.tryPromise({
      try: async () => {
        const resolved = resolveUserFilePath(stateFilePath);
        const raw = await fs.readFile(resolved, 'utf8');
        return parseJson<ApiStateFile>(raw, resolved);
      },
      catch: (error) => {
        const code = (error as any)?.code;
        if (code === 'ENOENT') return undefined as any;
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to read api state file',
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
          message: 'Failed to write api state file',
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
          message: 'Failed to delete api state file',
          exitCode: 1,
          details: { file_path: stateFilePath, error: String((error as any)?.message || error) },
        }),
    }),
} satisfies ApiDaemonFilesService);
