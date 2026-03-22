import fs from 'node:fs';

import * as Effect from 'effect/Effect';

import { loadBridgeUiContextSnapshot } from './business-semantics/uiContextResolution.js';
import { AppConfig } from '../services/AppConfig.js';
import { CliError } from '../services/Errors.js';
import {
  WorkspaceBindings,
  type WorkspaceBinding,
  type WorkspaceBindingSource,
} from '../services/WorkspaceBindings.js';
import {
  discoverWorkspaceCandidatesSync,
  tryParseRemnoteLinkFromRef,
  tryResolveRemnoteDbPathForWorkspaceIdSync,
  type WorkspaceCandidate,
} from './remnote.js';

export type WorkspaceResolutionSource = 'explicit' | 'binding' | 'live_ui_context' | 'single_candidate_auto' | 'unresolved';

export type WorkspaceResolution = {
  readonly resolved: boolean;
  readonly workspaceId?: string | undefined;
  readonly dbPath?: string | undefined;
  readonly source: WorkspaceResolutionSource;
  readonly kbName?: string | undefined;
  readonly bindingSource?: WorkspaceBindingSource | undefined;
  readonly candidates: readonly WorkspaceCandidate[];
  readonly reasons: readonly string[];
};

export type ResolvedWorkspace = WorkspaceResolution & {
  readonly resolved: true;
  readonly workspaceId: string;
  readonly dbPath: string;
};

export type ResolveWorkspaceParams = {
  readonly workspaceId?: string | undefined;
  readonly ref?: string | undefined;
  readonly stateFile?: string | undefined;
  readonly staleMs?: number | undefined;
};

function normalizeText(value: string | undefined): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : undefined;
}

function pathExists(filePath: string | undefined): filePath is string {
  if (!filePath) return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolvedFromBinding(params: {
  readonly binding: WorkspaceBinding;
  readonly source: Exclude<WorkspaceResolutionSource, 'unresolved'>;
  readonly candidates?: readonly WorkspaceCandidate[] | undefined;
  readonly reasons?: readonly string[] | undefined;
}): ResolvedWorkspace {
  return {
    resolved: true,
    workspaceId: params.binding.workspaceId,
    dbPath: params.binding.dbPath,
    source: params.source,
    kbName: params.binding.kbName,
    bindingSource: params.binding.source,
    candidates: params.candidates ?? [],
    reasons: params.reasons ?? [],
  };
}

function unresolved(params: {
  readonly candidates: readonly WorkspaceCandidate[];
  readonly reasons: readonly string[];
}): WorkspaceResolution {
  return {
    resolved: false,
    source: 'unresolved',
    candidates: params.candidates,
    reasons: params.reasons,
  };
}

function buildWorkspaceResolveError(params: {
  readonly requestedWorkspaceId?: string | undefined;
  readonly resolution: WorkspaceResolution;
}): CliError {
  const hasRequestedWorkspace = Boolean(normalizeText(params.requestedWorkspaceId));
  return new CliError({
    code: hasRequestedWorkspace ? 'DB_UNAVAILABLE' : 'WORKSPACE_UNRESOLVED',
    message: hasRequestedWorkspace
      ? `Workspace database is unavailable: ${params.requestedWorkspaceId}`
      : 'Workspace is unresolved',
    exitCode: 1,
    details: {
      requested_workspace_id: params.requestedWorkspaceId,
      candidates: params.resolution.candidates,
      reasons: params.resolution.reasons,
    },
    hint: hasRequestedWorkspace
      ? [
          'Open the target KB once in RemNote so the host can refresh the binding.',
          'Verify that the expected remnote.db file still exists on the host.',
        ]
      : [
          'Open the target KB once in RemNote so uiContext.kbId can establish a binding.',
          'Pass an explicit workspaceId or a RemNote deep link with /w/<workspaceId>/....',
        ],
  });
}

export function resolveWorkspaceSnapshot(
  params: ResolveWorkspaceParams,
): Effect.Effect<WorkspaceResolution, CliError, AppConfig | WorkspaceBindings> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const bindings = yield* WorkspaceBindings;
    const storeDbPath = cfg.storeDb;
    const recordedAt = Date.now();
    const requestedWorkspaceId = normalizeText(params.workspaceId);
    const linkWorkspaceId = params.ref ? normalizeText(tryParseRemnoteLinkFromRef(params.ref)?.workspaceId) : undefined;
    const explicitWorkspaceId = requestedWorkspaceId ?? linkWorkspaceId;
    const explicitBindingSource: WorkspaceBindingSource = requestedWorkspaceId ? 'explicit' : 'deep_link';

    const loadCandidates = (): WorkspaceCandidate[] => discoverWorkspaceCandidatesSync();

    if (explicitWorkspaceId) {
      const existing = yield* bindings.getByWorkspaceId({ storeDbPath, workspaceId: explicitWorkspaceId });
      if (existing && pathExists(existing.dbPath)) {
        const refreshed = yield* bindings.upsert({
          storeDbPath,
          workspaceId: existing.workspaceId,
          kbName: existing.kbName,
          dbPath: existing.dbPath,
          source: existing.source,
          makeCurrent: true,
          recordedAt,
          verifiedAt: recordedAt,
          lastUiContextAt: existing.lastUiContextAt,
        });
        return resolvedFromBinding({ binding: refreshed, source: 'explicit' });
      }

      const canonicalPath = tryResolveRemnoteDbPathForWorkspaceIdSync(explicitWorkspaceId);
      if (canonicalPath) {
        const upserted = yield* bindings.upsert({
          storeDbPath,
          workspaceId: explicitWorkspaceId,
          kbName: existing?.kbName,
          dbPath: canonicalPath,
          source: explicitBindingSource,
          makeCurrent: true,
          recordedAt,
          verifiedAt: recordedAt,
          lastUiContextAt: existing?.lastUiContextAt,
        });
        return resolvedFromBinding({ binding: upserted, source: 'explicit' });
      }

      return unresolved({
        candidates: loadCandidates(),
        reasons: [`No readable remnote.db found for workspace ${explicitWorkspaceId}`],
      });
    }

    const uiSnapshot = loadBridgeUiContextSnapshot({ stateFile: params.stateFile, staleMs: params.staleMs });
    let liveBinding: WorkspaceBinding | undefined;
    const liveKbId = uiSnapshot.status === 'ok' ? normalizeText(uiSnapshot.ui_context?.kbId) : undefined;
    if (liveKbId) {
      const liveDbPath = tryResolveRemnoteDbPathForWorkspaceIdSync(liveKbId);
      if (liveDbPath) {
        liveBinding = yield* bindings.upsert({
          storeDbPath,
          workspaceId: liveKbId,
          kbName: normalizeText(uiSnapshot.ui_context?.kbName),
          dbPath: liveDbPath,
          source: 'live_ui_context',
          makeCurrent: true,
          recordedAt,
          verifiedAt: recordedAt,
          lastUiContextAt: Number(uiSnapshot.ui_context?.updatedAt ?? recordedAt),
        });
      }
    }

    const current = yield* bindings.getCurrent({ storeDbPath });
    if (current && pathExists(current.dbPath)) {
      const refreshed = yield* bindings.upsert({
        storeDbPath,
        workspaceId: current.workspaceId,
        kbName: current.kbName,
        dbPath: current.dbPath,
        source: current.source,
        makeCurrent: true,
        recordedAt,
        verifiedAt: recordedAt,
        lastUiContextAt: current.lastUiContextAt,
      });
      return resolvedFromBinding({
        binding: refreshed,
        source: liveBinding && liveBinding.workspaceId === refreshed.workspaceId ? 'live_ui_context' : 'binding',
      });
    }

    const candidates = loadCandidates();
    const primaryCandidates = candidates.filter((candidate) => candidate.kind === 'primary');
    if (primaryCandidates.length === 1) {
      const only = primaryCandidates[0]!;
      const upserted = yield* bindings.upsert({
        storeDbPath,
        workspaceId: only.workspaceId,
        dbPath: only.dbPath,
        source: 'single_candidate_auto',
        makeCurrent: true,
        recordedAt,
        verifiedAt: recordedAt,
      });
      return resolvedFromBinding({ binding: upserted, source: 'single_candidate_auto', candidates: [only] });
    }

    const reasons: string[] = [];
    if (current && !pathExists(current.dbPath)) {
      reasons.push(`Current workspace binding points to a missing file: ${current.dbPath}`);
    }
    if (!liveBinding) {
      reasons.push(
        uiSnapshot.status === 'ok'
          ? 'UI context did not provide a resolvable kbId'
          : `UI context is unavailable (${uiSnapshot.status})`,
      );
    }
    if (primaryCandidates.length > 1) {
      reasons.push(`Multiple primary workspace candidates found: ${primaryCandidates.length}`);
    }
    if (primaryCandidates.length === 0) {
      reasons.push('No primary workspace candidates were discovered');
    }

    return unresolved({ candidates, reasons });
  });
}

export function requireResolvedWorkspace(
  params: ResolveWorkspaceParams,
): Effect.Effect<ResolvedWorkspace, CliError, AppConfig | WorkspaceBindings> {
  return resolveWorkspaceSnapshot(params).pipe(
    Effect.flatMap((resolution) => {
      if (resolution.resolved) return Effect.succeed(resolution as ResolvedWorkspace);
      const requestedWorkspaceId =
        normalizeText(params.workspaceId) ?? normalizeText(tryParseRemnoteLinkFromRef(params.ref ?? '')?.workspaceId);
      return Effect.fail(buildWorkspaceResolveError({ requestedWorkspaceId, resolution }));
    }),
  );
}
