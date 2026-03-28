import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CliError, isCliError } from './Errors.js';
import { resolveUserFilePath } from '../lib/paths.js';
import { defaultRuntimePath } from '../lib/runtime-ownership/paths.js';

export interface StatusLineFileService {
  readonly defaultTextFile: () => string;
  readonly defaultJsonFile: () => string;
  readonly write: (params: {
    readonly text: string;
    readonly textFilePath?: string | undefined;
    readonly debug?: boolean | undefined;
    readonly jsonFilePath?: string | undefined;
    readonly json?: unknown;
  }) => Effect.Effect<{ readonly wrote: boolean; readonly textFilePath: string }, CliError>;
}

export class StatusLineFile extends Context.Tag('StatusLineFile')<StatusLineFile, StatusLineFileService>() {}

function defaultTextFile(): string {
  return defaultRuntimePath('status-line.txt');
}

function defaultJsonFile(): string {
  return defaultRuntimePath('status-line.json');
}

function ensureDir(p: string): Promise<void> {
  return fs.mkdir(path.dirname(p), { recursive: true }).then(() => undefined);
}

async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (e: any) {
    if (e?.code === 'ENOENT') return '';
    throw e;
  }
}

async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await ensureDir(filePath);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, filePath);
}

export const StatusLineFileLive = Layer.succeed(StatusLineFile, {
  defaultTextFile: () => defaultTextFile(),
  defaultJsonFile: () => defaultJsonFile(),
  write: ({ text, textFilePath, debug, jsonFilePath, json }) =>
    Effect.tryPromise({
      try: async () => {
        const resolvedTextFile = resolveUserFilePath(textFilePath ?? defaultTextFile());
        const normalizedText = text.trimEnd();
        const desired = normalizedText.length > 0 ? `${normalizedText}\n` : '';

        const existing = await readFileOrEmpty(resolvedTextFile);
        if (existing === desired) return { wrote: false as const, textFilePath: resolvedTextFile };

        await writeTextAtomic(resolvedTextFile, desired);

        if (debug === true) {
          const resolvedJsonFile = resolveUserFilePath(jsonFilePath ?? defaultJsonFile());
          const payload = json !== undefined ? json : { text: normalizedText };
          await writeTextAtomic(resolvedJsonFile, `${JSON.stringify(payload)}\n`);
        }

        return { wrote: true as const, textFilePath: resolvedTextFile };
      },
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to write status line file',
          exitCode: 1,
          details: { error: String((error as any)?.message || error) },
        });
      },
    }),
} satisfies StatusLineFileService);
