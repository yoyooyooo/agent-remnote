import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CliError, isCliError } from './Errors.js';
import type { SupervisorStateFile } from '../kernel/supervisor/model.js';
export type { SupervisorLastExit, SupervisorStateFile, SupervisorStatus } from '../kernel/supervisor/model.js';
import { homeDir } from '../lib/paths.js';

export interface SupervisorStateService {
  readonly defaultStateFile: () => string;
  readonly readStateFile: (stateFilePath: string) => Effect.Effect<SupervisorStateFile | undefined, CliError>;
  readonly writeStateFile: (stateFilePath: string, value: SupervisorStateFile) => Effect.Effect<void, CliError>;
  readonly deleteStateFile: (stateFilePath: string) => Effect.Effect<void, CliError>;
}

export class SupervisorState extends Context.Tag('SupervisorState')<SupervisorState, SupervisorStateService>() {}

function ensureDir(p: string): Promise<void> {
  return fs.mkdir(path.dirname(p), { recursive: true }).then(() => undefined);
}

function defaultStateFile(): string {
  return path.join(homeDir(), '.agent-remnote', 'ws.state.json');
}

async function writeJsonAtomic(filePath: string, json: unknown): Promise<void> {
  await ensureDir(filePath);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(json), 'utf8');
  await fs.rename(tmp, filePath);
}

export const SupervisorStateLive = Layer.succeed(SupervisorState, {
  defaultStateFile: () => defaultStateFile(),
  readStateFile: (stateFilePath) =>
    Effect.tryPromise({
      try: async () => {
        try {
          const raw = await fs.readFile(stateFilePath, 'utf8');
          const parsed = JSON.parse(raw);
          return parsed as SupervisorStateFile;
        } catch (error: any) {
          if (error?.code === 'ENOENT') return undefined;
          throw error;
        }
      },
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to read supervisor state',
          exitCode: 1,
          details: { state_file: stateFilePath, error: String((error as any)?.message || error) },
        });
      },
    }),
  writeStateFile: (stateFilePath, value) =>
    Effect.tryPromise({
      try: async () => {
        await writeJsonAtomic(stateFilePath, value);
      },
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to write supervisor state',
          exitCode: 1,
          details: { state_file: stateFilePath, error: String((error as any)?.message || error) },
        });
      },
    }),
  deleteStateFile: (stateFilePath) =>
    Effect.tryPromise({
      try: async () => {
        try {
          await fs.unlink(stateFilePath);
        } catch (error: any) {
          if (error?.code === 'ENOENT') return;
          throw error;
        }
      },
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to delete supervisor state',
          exitCode: 1,
          details: { state_file: stateFilePath, error: String((error as any)?.message || error) },
        });
      },
    }),
} satisfies SupervisorStateService);
