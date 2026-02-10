import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CliError, isCliError } from './Errors.js';
import { resolveUserFilePath } from '../lib/paths.js';

export interface WsBridgeStateFileService {
  readonly write: (params: { readonly filePath: string; readonly json: unknown }) => Effect.Effect<void, CliError>;
}

export class WsBridgeStateFile extends Context.Tag('WsBridgeStateFile')<WsBridgeStateFile, WsBridgeStateFileService>() {}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await ensureDir(filePath);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, filePath);
}

export const WsBridgeStateFileLive = Layer.succeed(WsBridgeStateFile, {
  write: ({ filePath, json }) =>
    Effect.tryPromise({
      try: async () => {
        const resolved = resolveUserFilePath(filePath);
        await writeTextAtomic(resolved, `${JSON.stringify(json, null, 2)}\n`);
      },
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to write ws bridge state file',
          exitCode: 1,
          details: { file: filePath, error: String((error as any)?.message || error) },
        });
      },
    }),
} satisfies WsBridgeStateFileService);

