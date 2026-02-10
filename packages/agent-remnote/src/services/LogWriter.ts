import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as Scope from 'effect/Scope';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CliError, isCliError } from './Errors.js';

export type LogWriterOptions = {
  readonly maxBytes: number;
  readonly keep: number;
};

export type LogWriter = {
  write: (chunk: Buffer) => void;
  close: () => Promise<void>;
};

export interface LogWriterFactoryService {
  readonly open: (params: { readonly filePath: string; readonly options: LogWriterOptions }) => Effect.Effect<LogWriter, CliError, Scope.Scope>;
}

export class LogWriterFactory extends Context.Tag('LogWriterFactory')<LogWriterFactory, LogWriterFactoryService>() {}

type QueueItem = Buffer;

function sanitizePositiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sanitizeMaxBytes(value: number, fallback: number): number | null {
  // Treat 0 as "disable rotation" (keep writing to the same file).
  if (Number.isFinite(value) && value === 0) return null;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function safeStat(filePath: string): Promise<{ readonly size: number } | undefined> {
  try {
    const s = await fs.stat(filePath);
    return { size: s.size };
  } catch {
    return undefined;
  }
}

async function rotateFiles(filePath: string, keep: number): Promise<void> {
  if (keep <= 0) return;
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  const rotated = entries
    .filter((name) => name.startsWith(`${base}.`))
    .map((name) => path.join(dir, name))
    .sort()
    .reverse();
  for (const p of rotated.slice(keep)) {
    try {
      await fs.unlink(p);
    } catch {}
  }
}

export async function createLogWriter(filePath: string, options: LogWriterOptions): Promise<LogWriter> {
  const maxBytes = sanitizeMaxBytes(options.maxBytes, 20 * 1024 * 1024);
  const keep = sanitizePositiveInt(options.keep, 5);

  await ensureDir(filePath);

  let currentSize = (await safeStat(filePath))?.size ?? 0;
  let handle: fs.FileHandle | undefined;
  let closing = false;

  const queue: QueueItem[] = [];
  let flushing = false;

  async function openIfNeeded(): Promise<fs.FileHandle> {
    if (handle) return handle;
    handle = await fs.open(filePath, 'a');
    return handle;
  }

  async function rotateIfNeeded(nextBytes: number): Promise<void> {
    // Rotation disabled.
    if (maxBytes === null) return;
    if (currentSize + nextBytes <= maxBytes) return;

    try {
      await handle?.close();
    } catch {}
    handle = undefined;

    const rotatedPath = `${filePath}.${Date.now()}`;
    try {
      await fs.rename(filePath, rotatedPath);
    } catch {}

    currentSize = 0;
    await rotateFiles(filePath, keep);
  }

  async function flush(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      while (queue.length > 0) {
        const chunk = queue.shift()!;
        await rotateIfNeeded(chunk.byteLength);
        const out = await openIfNeeded();
        await out.write(chunk);
        currentSize += chunk.byteLength;
      }
    } finally {
      flushing = false;
      if (!closing && queue.length > 0) {
        setImmediate(() => {
          void flush();
        });
      }
    }
  }

  return {
    write: (chunk) => {
      if (closing) return;
      queue.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      void flush();
    },
    close: async () => {
      closing = true;
      await flush();
      try {
        await handle?.close();
      } catch {}
      handle = undefined;
    },
  };
}

export const LogWriterFactoryLive = Layer.succeed(LogWriterFactory, {
  open: ({ filePath, options }) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => await createLogWriter(filePath, options),
        catch: (e) =>
          isCliError(e)
            ? e
            : new CliError({
                code: 'INTERNAL',
                message: 'Failed to initialize log writer',
                exitCode: 1,
                details: { log_file: filePath, error: String((e as any)?.message || e) },
              }),
      }),
      (writer) => Effect.tryPromise({ try: () => writer.close(), catch: () => undefined }).pipe(Effect.ignore),
    ),
} satisfies LogWriterFactoryService);
