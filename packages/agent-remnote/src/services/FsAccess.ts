import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { constants as FS_CONSTANTS, promises as fs } from 'node:fs';
import path from 'node:path';

export type WritableCheck = { readonly ok: boolean; readonly reason?: string | undefined };

export interface FsAccessService {
  readonly isFile: (filePath: string) => Effect.Effect<boolean, never>;
  readonly canWritePath: (filePath: string) => Effect.Effect<boolean, never>;
  readonly checkWritableFile: (filePath: string) => Effect.Effect<WritableCheck, never>;
}

export class FsAccess extends Context.Tag('FsAccess')<FsAccess, FsAccessService>() {}

async function canWritePath(filePath: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.access(path.dirname(filePath), FS_CONSTANTS.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkWritableFile(filePath: string): Promise<WritableCheck> {
  const dir = path.dirname(filePath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    return { ok: false, reason: `failed_to_create_dir: ${String((e as any)?.message || e)}` };
  }

  try {
    await fs.access(dir, FS_CONSTANTS.W_OK);
  } catch (e) {
    return { ok: false, reason: `dir_not_writable: ${String((e as any)?.message || e)}` };
  }

  try {
    await fs.access(filePath, FS_CONSTANTS.W_OK);
    return { ok: true };
  } catch {
    // File may not exist yet; directory writability is enough for creating it.
    return { ok: true };
  }
}

export const FsAccessLive = Layer.succeed(FsAccess, {
  isFile: (filePath) =>
    Effect.tryPromise({
      try: async () => {
        const st = await fs.stat(filePath);
        return st.isFile();
      },
      catch: (e) => e,
    }).pipe(Effect.catchAll(() => Effect.succeed(false))),
  canWritePath: (filePath) =>
    Effect.tryPromise({
      try: async () => await canWritePath(filePath),
      catch: (e) => e,
    }).pipe(Effect.catchAll(() => Effect.succeed(false))),
  checkWritableFile: (filePath) =>
    Effect.tryPromise({
      try: async () => await checkWritableFile(filePath),
      catch: (e) => e,
    }).pipe(Effect.catchAll(() => Effect.succeed({ ok: false, reason: 'unknown_error' }))),
} satisfies FsAccessService);
