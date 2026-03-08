import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';

import { CliError, isCliError } from './Errors.js';
import { resolveUserFilePath } from '../lib/paths.js';

export interface FileInputService {
  readonly readTextFromFileSpec: (params: {
    readonly spec: string;
    readonly maxBytes?: number | undefined;
  }) => Effect.Effect<string, CliError>;
}

export class FileInput extends Context.Tag('FileInput')<FileInput, FileInputService>() {}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

async function readAllStdin(maxBytes: number): Promise<string> {
  if (process.stdin.isTTY) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: 'When using -, input must be piped via stdin',
      exitCode: 2,
    });
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buf.byteLength;
    if (totalBytes > maxBytes) {
      throw new CliError({
        code: 'PAYLOAD_TOO_LARGE',
        message: `Input is too large (${totalBytes} bytes); split it and try again`,
        exitCode: 2,
        details: { bytes: totalBytes, max_bytes: maxBytes },
      });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readTextFromFilePath(pathSpec: string, maxBytes: number): Promise<string> {
  const trimmed = pathSpec.trim();
  if (!trimmed) {
    throw new CliError({ code: 'INVALID_ARGS', message: 'File path cannot be empty', exitCode: 2 });
  }

  const resolved = resolveUserFilePath(trimmed);

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      throw new CliError({ code: 'INVALID_ARGS', message: `Not a file: ${resolved}`, exitCode: 2 });
    }
    if (Number.isFinite(stat.size) && stat.size > maxBytes) {
      throw new CliError({
        code: 'PAYLOAD_TOO_LARGE',
        message: `Input is too large (${stat.size} bytes); split it and try again`,
        exitCode: 2,
        details: { bytes: stat.size, max_bytes: maxBytes, file: resolved },
      });
    }
    return await fs.readFile(resolved, 'utf8');
  } catch (error: any) {
    if (isCliError(error)) throw error;
    if (error?.code === 'ENOENT') {
      throw new CliError({ code: 'INVALID_ARGS', message: `File not found: ${resolved}`, exitCode: 2 });
    }
    throw new CliError({
      code: 'INTERNAL',
      message: 'Failed to read file',
      exitCode: 1,
      details: { file: resolved, error: String((error as any)?.message || error) },
    });
  }
}

function normalizeFileSpec(spec: string): string {
  const s = spec.trim();
  if (s.startsWith('@')) return s.slice(1).trim();
  return s;
}

export const FileInputLive = Layer.succeed(FileInput, {
  readTextFromFileSpec: ({ spec, maxBytes }) =>
    Effect.tryPromise({
      try: async () => {
        const limit =
          typeof maxBytes === 'number' && Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;
        const normalized = normalizeFileSpec(spec);
        if (normalized === '-') return await readAllStdin(limit);
        return await readTextFromFilePath(normalized, limit);
      },
      catch: (error) => {
        if (isCliError(error)) return error;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to read input',
          exitCode: 1,
          details: { error: String((error as any)?.message || error) },
        });
      },
    }),
} satisfies FileInputService);
