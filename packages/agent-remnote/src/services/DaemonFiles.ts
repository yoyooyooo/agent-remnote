import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CliError, isCliError } from './Errors.js';
import { resolveUserFilePath } from '../lib/paths.js';
import type { RuntimeBuildInfo } from '../lib/runtimeBuildInfo.js';
import type { RuntimeOwnerDescriptor } from '../lib/runtime-ownership/ownerDescriptor.js';
import { defaultRuntimePath } from '../lib/runtime-ownership/paths.js';

export type WsPidFile = {
  readonly pid: number;
  readonly build?: RuntimeBuildInfo | undefined;
  readonly owner?: RuntimeOwnerDescriptor | undefined;
  readonly started_at?: number | undefined;
  readonly ws_url?: string | undefined;
  readonly log_file?: string | undefined;
  readonly queue_db?: string | undefined;
  readonly cmd?: readonly string[] | undefined;
  // Supervisor mode (incremental additions; forward-only)
  readonly mode?: 'supervisor' | undefined;
  readonly child_pid?: number | null | undefined;
  readonly child_started_at?: number | null | undefined;
  readonly state_file?: string | undefined;
  // Statusline artifacts (forward-only; used for best-effort cleanup and tmux helpers)
  readonly ws_bridge_state_file?: string | undefined;
  readonly status_line_file?: string | undefined;
  readonly status_line_json_file?: string | undefined;
};

export interface DaemonFilesService {
  readonly defaultPidFile: () => string;
  readonly defaultLogFile: () => string;
  readonly readPidFile: (pidFilePath: string) => Effect.Effect<WsPidFile | undefined, CliError>;
  readonly writePidFile: (pidFilePath: string, value: WsPidFile) => Effect.Effect<void, CliError>;
  readonly deletePidFile: (pidFilePath: string) => Effect.Effect<void, CliError>;
}

export class DaemonFiles extends Context.Tag('DaemonFiles')<DaemonFiles, DaemonFilesService>() {}

function ensureDir(p: string): Promise<void> {
  return fs.mkdir(path.dirname(p), { recursive: true }).then(() => undefined);
}

function defaultPidFile(): string {
  const envPidFile = process.env.REMNOTE_DAEMON_PID_FILE || process.env.DAEMON_PID_FILE;
  if (typeof envPidFile === 'string' && envPidFile.trim()) return resolveUserFilePath(envPidFile);
  return defaultRuntimePath('ws.pid');
}

function defaultLogFile(): string {
  const envLogFile = process.env.REMNOTE_DAEMON_LOG_FILE || process.env.DAEMON_LOG_FILE;
  if (typeof envLogFile === 'string' && envLogFile.trim()) return resolveUserFilePath(envLogFile);
  return defaultRuntimePath('ws.log');
}

async function writeJsonAtomic(filePath: string, json: unknown): Promise<void> {
  await ensureDir(filePath);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(json), 'utf8');
  await fs.rename(tmp, filePath);
}

export const DaemonFilesLive = Layer.succeed(DaemonFiles, {
  defaultPidFile: () => defaultPidFile(),
  defaultLogFile: () => defaultLogFile(),
  readPidFile: (pidFilePath) =>
    Effect.tryPromise({
      try: async () => {
        try {
          const raw = await fs.readFile(pidFilePath, 'utf8');
          const parsed = JSON.parse(raw);
          return parsed as WsPidFile;
        } catch (error: any) {
          if (error?.code === 'ENOENT') return undefined;
          throw error;
        }
      },
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to read pidfile',
          exitCode: 1,
          details: { pid_file: pidFilePath, error: String((error as any)?.message || error) },
        });
      },
    }),
  writePidFile: (pidFilePath, value) =>
    Effect.tryPromise({
      try: async () => {
        await writeJsonAtomic(pidFilePath, value);
      },
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to write pidfile',
          exitCode: 1,
          details: { pid_file: pidFilePath, error: String((error as any)?.message || error) },
        });
      },
    }),
  deletePidFile: (pidFilePath) =>
    Effect.tryPromise({
      try: async () => {
        try {
          await fs.unlink(pidFilePath);
        } catch (error: any) {
          if (error?.code === 'ENOENT') return;
          throw error;
        }
      },
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to delete pidfile',
          exitCode: 1,
          details: { pid_file: pidFilePath, error: String((error as any)?.message || error) },
        });
      },
    }),
} satisfies DaemonFilesService);
