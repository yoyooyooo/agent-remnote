import * as Effect from 'effect/Effect';
import { promises as fs } from 'node:fs';

import type { ResolvedConfig } from '../services/Config.js';
import type { WsPidFile } from '../services/DaemonFiles.js';
import { StatusLineFile } from '../services/StatusLineFile.js';
import { resolveUserFilePath } from './paths.js';

export type StatuslineArtifactPaths = {
  readonly wsBridgeStateFilePath: string;
  readonly statusLineFilePath: string;
  readonly statusLineJsonFilePath: string;
};

export type CleanupOutcome =
  | { readonly action: 'deleted' | 'cleared' | 'skipped'; readonly file: string }
  | { readonly action: 'failed'; readonly file: string; readonly error: string };

export type StatuslineArtifactsCleanupReport = {
  readonly wsBridgeStateFile: CleanupOutcome;
  readonly statusLineFile: CleanupOutcome;
  readonly statusLineJsonFile: CleanupOutcome;
};

function normalizeOptionalPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t.length > 0 ? resolveUserFilePath(t) : undefined;
}

export function resolveStatuslineArtifactPaths(params: {
  readonly cfg: Pick<ResolvedConfig, 'wsStateFile' | 'statusLineFile' | 'statusLineJsonFile'>;
  readonly pidInfo?: WsPidFile | undefined;
}): StatuslineArtifactPaths {
  const pidInfo = params.pidInfo;
  const wsBridgeStateFilePath =
    normalizeOptionalPath((pidInfo as any)?.ws_bridge_state_file) ?? params.cfg.wsStateFile.path;
  const statusLineFilePath = normalizeOptionalPath((pidInfo as any)?.status_line_file) ?? params.cfg.statusLineFile;
  const statusLineJsonFilePath =
    normalizeOptionalPath((pidInfo as any)?.status_line_json_file) ?? params.cfg.statusLineJsonFile;
  return { wsBridgeStateFilePath, statusLineFilePath, statusLineJsonFilePath };
}

function deleteFileIfExists(filePath: string): Effect.Effect<CleanupOutcome, never> {
  return Effect.promise(async () => {
    try {
      await fs.unlink(filePath);
      return { action: 'deleted', file: filePath } as const;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return { action: 'skipped', file: filePath } as const;
      return { action: 'failed', file: filePath, error: String((e as any)?.message || e) } as const;
    }
  });
}

export function cleanupStatuslineArtifacts(
  paths: StatuslineArtifactPaths,
): Effect.Effect<StatuslineArtifactsCleanupReport, never, StatusLineFile> {
  return Effect.gen(function* () {
    const statusLineFile = yield* StatusLineFile;

    const wsBridgeStateFile = yield* deleteFileIfExists(paths.wsBridgeStateFilePath);

    const cleared = yield* statusLineFile
      .write({ text: '', textFilePath: paths.statusLineFilePath, debug: false })
      .pipe(Effect.either);
    const statusLineFileOutcome: CleanupOutcome =
      cleared._tag === 'Right'
        ? cleared.right.wrote
          ? { action: 'cleared', file: cleared.right.textFilePath }
          : { action: 'skipped', file: cleared.right.textFilePath }
        : {
            action: 'failed',
            file: paths.statusLineFilePath,
            error: String((cleared.left as any)?.message || cleared.left),
          };

    const statusLineJsonFile = yield* deleteFileIfExists(paths.statusLineJsonFilePath);

    return { wsBridgeStateFile, statusLineFile: statusLineFileOutcome, statusLineJsonFile };
  });
}
