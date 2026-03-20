import * as Effect from 'effect/Effect';

import { resolveWorkspaceSnapshot } from '../../../lib/workspaceResolver.js';
import { looksLikeStructuredMarkdown, trimBoundaryBlankLines } from '../../../lib/text.js';
import { failInRemoteMode } from '../../_remoteMode.js';
import { AppConfig } from '../../../services/AppConfig.js';
import { CliError } from '../../../services/Errors.js';
import type { FileInput } from '../../../services/FileInput.js';
import { HostApiClient } from '../../../services/HostApiClient.js';
import { RemDb } from '../../../services/RemDb.js';
import { RefResolver } from '../../../services/RefResolver.js';
import { WorkspaceBindings } from '../../../services/WorkspaceBindings.js';

import { normalizeRemIdInput, readMarkdownArg, resolveCurrentSelectionRemIds } from './children/common.js';

export const DURABLE_TARGET_ALIAS = 'durable_target';
export const PORTAL_REM_ALIAS = 'portal_rem';

export type CreatePromotionContentSource =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'markdown'; readonly markdown: string }
  | {
      readonly kind: 'targets';
      readonly remIds: readonly string[];
      readonly sourceOrigin: 'explicit_targets' | 'selection';
    };

export type PromotionPlacement =
  | { readonly kind: 'parent'; readonly parentRef: string; readonly position?: number | undefined }
  | { readonly kind: 'before'; readonly anchorRef: string }
  | { readonly kind: 'after'; readonly anchorRef: string }
  | { readonly kind: 'standalone' };

export type PromotionPortalPlacement =
  | { readonly kind: 'none' }
  | { readonly kind: 'parent'; readonly parentRef: string }
  | { readonly kind: 'before'; readonly anchorRef: string }
  | { readonly kind: 'after'; readonly anchorRef: string }
  | { readonly kind: 'in_place_selection_range' };

export type NormalizedCreatePromotionIntent = {
  readonly source: CreatePromotionContentSource;
  readonly contentPlacement: PromotionPlacement;
  readonly portalPlacement: PromotionPortalPlacement;
  readonly destinationTitle: string;
  readonly isDocument: boolean;
  readonly tags: readonly string[];
  readonly hasBodyTextChild: boolean;
};

export type CreatePromotionArgs = {
  readonly parent?: string | undefined;
  readonly ref?: string | undefined;
  readonly before?: string | undefined;
  readonly after?: string | undefined;
  readonly standalone: boolean;
  readonly text?: string | undefined;
  readonly markdown?: string | undefined;
  readonly target: readonly string[];
  readonly fromSelection: boolean;
  readonly title?: string | undefined;
  readonly isDocument: boolean;
  readonly tag: readonly string[];
  readonly position?: number | undefined;
  readonly forceText: boolean;
  readonly portalParent?: string | undefined;
  readonly portalBefore?: string | undefined;
  readonly portalAfter?: string | undefined;
  readonly leavePortalInPlace: boolean;
};

export type MovePromotionArgs = {
  readonly rem: string;
  readonly parent?: string | undefined;
  readonly ref?: string | undefined;
  readonly before?: string | undefined;
  readonly after?: string | undefined;
  readonly standalone: boolean;
  readonly isDocument: boolean;
  readonly leavePortal: boolean;
  readonly position?: number | undefined;
};

export type NormalizedMovePromotionIntent = {
  readonly remId: string;
  readonly contentPlacement: PromotionPlacement;
  readonly isDocument: boolean;
  readonly leavePortal: boolean;
};

function invalidArgs(message: string, details?: Record<string, unknown>): CliError {
  return new CliError({
    code: 'INVALID_ARGS',
    message,
    exitCode: 2,
    details,
  });
}

function normalizeOptionalText(raw: string | undefined): string | undefined {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed ? trimmed : undefined;
}

function looksLikeResolverRef(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (s.startsWith('remnote://') || s.startsWith('http://') || s.startsWith('https://')) return true;
  const idx = s.indexOf(':');
  if (idx <= 0) return false;
  const prefix = s.slice(0, idx).trim().toLowerCase();
  return prefix === 'id' || prefix === 'page' || prefix === 'title' || prefix === 'daily';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function pickTitle(kt: unknown, ke: unknown, r: unknown): string {
  const combined = [kt, ke].map(normalizeText).filter(Boolean).join(' | ');
  const raw = combined || normalizeText(r);
  if (!raw) return '';
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const title = normalized.split(/\n| - |——|。|！|？|\.|: /)[0]?.trim() || normalized;
  return truncateText(title, 80);
}

function fetchRemTitleMap(db: any, ids: readonly string[]): Map<string, string> {
  const unique = Array.from(new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean)));
  if (unique.length === 0) return new Map();

  const placeholders = unique.map(() => '?').join(',');
  const stmt = db.prepare(
    `SELECT id,
            json_extract(doc, '$.kt') AS kt,
            json_extract(doc, '$.ke') AS ke,
            json_extract(doc, '$.r') AS r
       FROM remsSearchInfos
      WHERE id IN (${placeholders})`,
  );
  const rows = stmt.all(...unique) as Array<{ id: string; kt: unknown; ke: unknown; r: unknown }>;

  const map = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.id ?? '').trim();
    if (!id) continue;
    map.set(id, pickTitle(row.kt, row.ke, row.r));
  }
  return map;
}

function readSingleRemTitle(params: {
  readonly ids: readonly string[];
  readonly selectionTitle?: string | undefined;
}): Effect.Effect<string | undefined, CliError, AppConfig | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    const ids = Array.from(new Set(params.ids.map((id) => String(id ?? '').trim()).filter(Boolean)));
    if (ids.length !== 1) return undefined;

    const selectionTitle = normalizeOptionalText(params.selectionTitle);
    if (selectionTitle) return selectionTitle;

    const cfg = yield* AppConfig;
    if (cfg.apiBaseUrl) return undefined;

    const remDb = yield* RemDb;
    const workspace = cfg.remnoteDb
      ? undefined
      : yield* resolveWorkspaceSnapshot({}).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    const dbPath = cfg.remnoteDb ?? (workspace?.resolved ? workspace.dbPath : undefined);
    if (!dbPath) return undefined;

    const titleMap = yield* remDb.withDb(dbPath, async (db) => fetchRemTitleMap(db, ids)).pipe(
      Effect.map((value) => value.result),
      Effect.catchAll(() => Effect.succeed(new Map<string, string>())),
    );

    return normalizeOptionalText(titleMap.get(ids[0]!));
  });
}

type RemLayout = {
  readonly id: string;
  readonly parentId: string | null;
  readonly sortKey: string | null;
};

function fetchRemLayouts(db: any, ids: readonly string[]): Map<string, RemLayout> {
  const unique = Array.from(new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean)));
  if (unique.length === 0) return new Map();

  const placeholders = unique.map(() => '?').join(',');
  const stmt = db.prepare(
    `SELECT _id AS id,
            json_extract(doc, '$.parent') AS parentId,
            json_extract(doc, '$.f') AS sortKey
       FROM quanta
      WHERE _id IN (${placeholders})`,
  );
  const rows = stmt.all(...unique) as Array<{ id: string; parentId: unknown; sortKey: unknown }>;

  const out = new Map<string, RemLayout>();
  for (const row of rows) {
    const id = String(row.id ?? '').trim();
    if (!id) continue;
    out.set(id, {
      id,
      parentId: normalizeText(row.parentId) || null,
      sortKey: normalizeText(row.sortKey) || null,
    });
  }
  return out;
}

function listSiblingOrder(
  db: any,
  parentId: string,
): readonly string[] {
  const stmt = db.prepare(
    `SELECT _id AS id
       FROM quanta
      WHERE json_extract(doc, '$.parent') = ?
      ORDER BY json_extract(doc, '$.f')`,
  );
  const rows = stmt.all(parentId) as Array<{ id: string }>;
  return rows.map((row) => String(row.id ?? '').trim()).filter(Boolean);
}

function resolveLocalDbPath(): Effect.Effect<string, CliError, AppConfig | WorkspaceBindings> {
  return Effect.gen(function* () {
    yield* failInRemoteMode({
      command: 'promotion anchor/selection resolution',
      reason: 'this path still reads local RemNote hierarchy metadata to resolve before/after and selection placement',
    });

    const cfg = yield* AppConfig;
    if (cfg.remnoteDb) return cfg.remnoteDb;

    const workspace = yield* resolveWorkspaceSnapshot({}).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
    const dbPath = workspace?.resolved ? workspace.dbPath : undefined;
    if (dbPath) return dbPath;

    return yield* Effect.fail(
      new CliError({
        code: 'WORKSPACE_UNRESOLVED',
        message: 'Workspace is unresolved for promotion anchor/selection resolution',
        exitCode: 1,
      }),
    );
  });
}

function resolveAnchorPlacement(params: {
  readonly anchorRef: string;
  readonly offset: 0 | 1;
}): Effect.Effect<{ readonly parentId: string; readonly position: number }, CliError, AppConfig | RefResolver | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    const refs = yield* RefResolver;
    const remDb = yield* RemDb;
    const dbPath = yield* resolveLocalDbPath();
    const anchorId = looksLikeResolverRef(params.anchorRef)
      ? yield* refs.resolve(params.anchorRef)
      : normalizeRemIdInput(params.anchorRef);
    const layouts = yield* remDb.withDb(dbPath, async (db) => fetchRemLayouts(db, [anchorId])).pipe(
      Effect.map((result) => result.result),
    );
    const layout = layouts.get(anchorId);

    if (!layout) {
      return yield* Effect.fail(
        invalidArgs(`Anchor Rem not found: ${params.anchorRef}`, { anchor_ref: params.anchorRef }),
      );
    }
    if (!layout.parentId) {
      return yield* Effect.fail(
        invalidArgs('Anchor-relative placement requires an anchor with a parent (top-level anchors are unsupported)', {
          anchor_ref: params.anchorRef,
          anchor_id: anchorId,
        }),
      );
    }
    const siblingOrder = yield* remDb.withDb(dbPath, async (db) => listSiblingOrder(db, layout.parentId!)).pipe(
      Effect.map((result) => result.result),
    );
    const index = siblingOrder.indexOf(anchorId);
    if (index < 0) {
      return yield* Effect.fail(
        invalidArgs('Failed to resolve anchor sibling position', {
          anchor_ref: params.anchorRef,
          anchor_id: anchorId,
        }),
      );
    }

    return {
      parentId: layout.parentId,
      position: index + params.offset,
    };
  });
}

function resolveParentTargetId(
  raw: string,
): Effect.Effect<string, CliError, AppConfig | RefResolver | WorkspaceBindings> {
  return Effect.gen(function* () {
    const refs = yield* RefResolver;
    return looksLikeResolverRef(raw) ? yield* refs.resolve(raw) : normalizeRemIdInput(raw);
  });
}

function resolveSelectionLayout(params: {
  readonly remIds: readonly string[];
}): Effect.Effect<{ readonly orderedRemIds: readonly string[]; readonly parentId: string; readonly position: number }, CliError, AppConfig | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    const remDb = yield* RemDb;
    const dbPath = yield* resolveLocalDbPath();
    const layouts = yield* remDb.withDb(dbPath, async (db) => fetchRemLayouts(db, params.remIds)).pipe(
      Effect.map((result) => result.result),
    );

    const entries = params.remIds.map((id) => layouts.get(id)).filter((value): value is RemLayout => Boolean(value));
    if (entries.length !== params.remIds.length) {
      return yield* Effect.fail(
        invalidArgs('Current selection could not be fully resolved from the local RemNote DB', {
          expected: params.remIds.length,
          resolved: entries.length,
        }),
      );
    }

    const parentIds = Array.from(
      new Set(entries.map((entry) => entry.parentId).filter((value): value is string => Boolean(value))),
    );
    if (parentIds.length !== 1) {
      return yield* Effect.fail(
        invalidArgs('Current selection must resolve to contiguous sibling Rems under the same parent', {
          parent_count: parentIds.length,
        }),
      );
    }

    const siblingOrder = yield* remDb.withDb(dbPath, async (db) => listSiblingOrder(db, parentIds[0]!)).pipe(
      Effect.map((result) => result.result),
    );
    const indexed = entries
      .map((entry) => ({ entry, index: siblingOrder.indexOf(entry.id) }))
      .sort((a, b) => a.index - b.index);
    const first = indexed[0];
    if (!first || first.index < 0) {
      return yield* Effect.fail(invalidArgs('Failed to resolve selection sibling position'));
    }

    for (let offset = 0; offset < indexed.length; offset += 1) {
      const current = indexed[offset]!;
      if (current.index !== first.index + offset) {
        return yield* Effect.fail(
          invalidArgs('Current selection must be contiguous sibling Rems under the same parent', {
            actual_positions: indexed.map((item) => item.index),
          }),
        );
      }
    }

    return {
      orderedRemIds: indexed.map((item) => item.entry.id),
      parentId: parentIds[0]!,
      position: first.index,
    };
  });
}

function readPlacementCount(args: CreatePromotionArgs): number {
  let count = 0;
  if (args.parent || args.ref) count += 1;
  if (args.before) count += 1;
  if (args.after) count += 1;
  if (args.standalone) count += 1;
  return count;
}

function readPortalPlacementCount(args: CreatePromotionArgs): number {
  let count = 0;
  if (args.portalParent) count += 1;
  if (args.portalBefore) count += 1;
  if (args.portalAfter) count += 1;
  if (args.leavePortalInPlace) count += 1;
  return count;
}

export function isCreatePromotionMode(args: CreatePromotionArgs): boolean {
  return Boolean(
    (Array.isArray(args.target) && args.target.length > 0) ||
      args.fromSelection ||
      args.markdown ||
      args.title ||
      args.before ||
      args.after ||
      args.standalone ||
      args.portalParent ||
      args.portalBefore ||
      args.portalAfter ||
      args.leavePortalInPlace,
  );
}

export function normalizeCreatePromotionIntent(
  args: CreatePromotionArgs,
): Effect.Effect<
  NormalizedCreatePromotionIntent,
  CliError,
  FileInput | AppConfig | RemDb | WorkspaceBindings | HostApiClient | RefResolver
> {
  return Effect.gen(function* () {
    if (args.position !== undefined && (!Number.isFinite(args.position) || args.position < 0)) {
      return yield* Effect.fail(
        invalidArgs('--position must be a non-negative integer', {
          position: args.position,
        }),
      );
    }

    if (args.parent && args.ref) {
      return yield* Effect.fail(invalidArgs('Choose only one of --parent or --ref'));
    }

    const placementCount = readPlacementCount(args);
    if (placementCount > 1) {
      return yield* Effect.fail(
        invalidArgs('Choose exactly one content placement: --parent/--ref, --before, --after, or --standalone'),
      );
    }
    if (placementCount === 0) {
      return yield* Effect.fail(
        invalidArgs('You must provide one content placement: --parent/--ref, --before, --after, or --standalone'),
      );
    }

    if (args.position !== undefined && !(args.parent || args.ref)) {
      return yield* Effect.fail(invalidArgs('--position is only supported with --parent or --ref'));
    }

    const portalPlacementCount = readPortalPlacementCount(args);
    if (portalPlacementCount > 1) {
      return yield* Effect.fail(
        invalidArgs('Choose at most one portal placement: --portal-parent, --portal-before, --portal-after, or --leave-portal-in-place'),
      );
    }

    const textValue = args.text !== undefined ? trimBoundaryBlankLines(args.text) : undefined;
    const hasTextSource = textValue !== undefined;
    const hasMarkdownSource = normalizeOptionalText(args.markdown) !== undefined;
    const explicitTargetIds = Array.isArray(args.target) ? args.target.map(normalizeRemIdInput).filter(Boolean) : [];
    const hasExplicitTargets = explicitTargetIds.length > 0;
    const hasSelectionSource = args.fromSelection === true;
    const sourceCount =
      (hasTextSource ? 1 : 0) + (hasMarkdownSource ? 1 : 0) + (hasExplicitTargets ? 1 : 0) + (hasSelectionSource ? 1 : 0);

    if (sourceCount > 1) {
      return yield* Effect.fail(
        invalidArgs('Choose exactly one content source: --text, --markdown, repeated --target, or --from-selection'),
      );
    }
    if (sourceCount === 0) {
      return yield* Effect.fail(
        invalidArgs('You must provide one content source: --text, --markdown, repeated --target, or --from-selection'),
      );
    }

    const title = normalizeOptionalText(args.title);
    if (hasMarkdownSource && !title) {
      return yield* Effect.fail(invalidArgs('rem create --markdown requires --title'));
    }

    if (hasSelectionSource && (hasTextSource || hasMarkdownSource || hasExplicitTargets)) {
      return yield* Effect.fail(
        invalidArgs('--from-selection cannot be combined with --text, --markdown, or explicit --target'),
      );
    }

    if (hasTextSource && textValue && !args.forceText && looksLikeStructuredMarkdown(textValue)) {
      return yield* Effect.fail(
        invalidArgs(
          'Input passed to --text looks like structured Markdown. Use --markdown instead, or pass --force-text to keep it literal.',
        ),
      );
    }

    if (args.leavePortalInPlace && !hasSelectionSource) {
      return yield* Effect.fail(invalidArgs('--leave-portal-in-place is only supported with --from-selection'));
    }

    const contentPlacement: PromotionPlacement = (() => {
      if (args.parent || args.ref) {
        return {
          kind: 'parent',
          parentRef: normalizeRemIdInput(args.parent ?? args.ref ?? ''),
          ...(args.position !== undefined ? { position: args.position } : {}),
        };
      }
      if (args.before) return { kind: 'before', anchorRef: normalizeRemIdInput(args.before) };
      if (args.after) return { kind: 'after', anchorRef: normalizeRemIdInput(args.after) };
      return { kind: 'standalone' };
    })();

    const portalPlacement: PromotionPortalPlacement = (() => {
      if (args.portalParent) return { kind: 'parent', parentRef: normalizeRemIdInput(args.portalParent) };
      if (args.portalBefore) return { kind: 'before', anchorRef: normalizeRemIdInput(args.portalBefore) };
      if (args.portalAfter) return { kind: 'after', anchorRef: normalizeRemIdInput(args.portalAfter) };
      if (args.leavePortalInPlace) return { kind: 'in_place_selection_range' };
      return { kind: 'none' };
    })();

    if (hasMarkdownSource) {
      const markdown = yield* readMarkdownArg(args.markdown!);
      return {
        source: { kind: 'markdown', markdown },
        contentPlacement,
        portalPlacement,
        destinationTitle: title!,
        isDocument: args.isDocument,
        tags: Array.isArray(args.tag) ? args.tag.map(normalizeRemIdInput).filter(Boolean) : [],
        hasBodyTextChild: false,
      };
    }

    if (hasExplicitTargets || hasSelectionSource) {
      const resolvedSelection = hasSelectionSource ? yield* resolveCurrentSelectionRemIds({}) : undefined;
      const selectionLayout =
        hasSelectionSource ? yield* resolveSelectionLayout({ remIds: resolvedSelection?.rem_ids ?? [] }) : undefined;
      const remIds = hasExplicitTargets ? explicitTargetIds : selectionLayout?.orderedRemIds ?? [];
      const sourceOrigin = hasExplicitTargets ? ('explicit_targets' as const) : ('selection' as const);

      const inferredTitle = !title
        ? yield* readSingleRemTitle({
            ids: remIds,
            selectionTitle:
              sourceOrigin === 'selection' &&
              remIds.length === 1 &&
              String((resolvedSelection as any)?.selection?.current?.id ?? '').trim() === remIds[0]
                ? normalizeOptionalText(String((resolvedSelection as any)?.selection?.current?.title ?? ''))
                : undefined,
          })
        : undefined;

      const destinationTitle = title ?? inferredTitle;
      if (!destinationTitle) {
        return yield* Effect.fail(
          invalidArgs(
            remIds.length > 1
              ? 'rem create with multiple --target values requires --title'
              : sourceOrigin === 'selection'
                ? 'rem create --from-selection could not infer a title from the single selected Rem; pass --title explicitly'
                : 'rem create could not infer a title from the single --target Rem; pass --title explicitly',
          ),
        );
      }

      return {
        source: { kind: 'targets', remIds, sourceOrigin },
        contentPlacement,
        portalPlacement,
        destinationTitle,
        isDocument: args.isDocument,
        tags: Array.isArray(args.tag) ? args.tag.map(normalizeRemIdInput).filter(Boolean) : [],
        hasBodyTextChild: false,
      };
    }

    const normalizedText = textValue ?? '';
    return {
      source: { kind: 'text', text: normalizedText },
      contentPlacement,
      portalPlacement,
      destinationTitle: title ?? normalizedText,
      isDocument: args.isDocument,
      tags: Array.isArray(args.tag) ? args.tag.map(normalizeRemIdInput).filter(Boolean) : [],
      hasBodyTextChild: Boolean(title),
    };
  });
}

export function buildCreatePromotionActions(
  intent: NormalizedCreatePromotionIntent,
): Effect.Effect<readonly Record<string, unknown>[], CliError, AppConfig | RefResolver | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    const destinationInput: Record<string, unknown> = {
      text: intent.destinationTitle,
      ...(intent.isDocument ? { is_document: true } : {}),
      ...(intent.tags.length > 0 ? { tags: intent.tags } : {}),
    };

    switch (intent.contentPlacement.kind) {
      case 'parent':
        destinationInput.parent_id = yield* resolveParentTargetId(intent.contentPlacement.parentRef);
        if (intent.contentPlacement.position !== undefined) {
          destinationInput.position = intent.contentPlacement.position;
        }
        break;
      case 'standalone':
        destinationInput.standalone = true;
        break;
      case 'before': {
        const resolved = yield* resolveAnchorPlacement({
          anchorRef: intent.contentPlacement.anchorRef,
          offset: 0,
        });
        destinationInput.parent_id = resolved.parentId;
        destinationInput.position = resolved.position;
        break;
      }
      case 'after': {
        const resolved = yield* resolveAnchorPlacement({
          anchorRef: intent.contentPlacement.anchorRef,
          offset: 1,
        });
        destinationInput.parent_id = resolved.parentId;
        destinationInput.position = resolved.position;
        break;
      }
    }

    const actions: Record<string, unknown>[] = [
      {
        as: DURABLE_TARGET_ALIAS,
        action: 'write.bullet',
        input: destinationInput,
      },
    ];

    if (intent.source.kind === 'markdown') {
      actions.push({
        action: 'rem.children.append',
        input: {
          rem_id: `@${DURABLE_TARGET_ALIAS}`,
          markdown: intent.source.markdown,
        },
      });
    }

    if (intent.source.kind === 'text' && intent.hasBodyTextChild) {
      actions.push({
        action: 'write.bullet',
        input: {
          parent_id: `@${DURABLE_TARGET_ALIAS}`,
          text: intent.source.text,
        },
      });
    }

    if (intent.source.kind === 'targets') {
      for (const remId of intent.source.remIds) {
        actions.push({
          action: 'rem.move',
          input: {
            rem_id: remId,
            new_parent_id: `@${DURABLE_TARGET_ALIAS}`,
          },
        });
      }
    }

    switch (intent.portalPlacement.kind) {
      case 'none':
        break;
      case 'parent':
        actions.push({
          as: PORTAL_REM_ALIAS,
          action: 'portal.create',
          input: {
            parent_id: yield* resolveParentTargetId(intent.portalPlacement.parentRef),
            target_rem_id: `@${DURABLE_TARGET_ALIAS}`,
          },
        });
        break;
      case 'before': {
        const resolved = yield* resolveAnchorPlacement({
          anchorRef: intent.portalPlacement.anchorRef,
          offset: 0,
        });
        actions.push({
          as: PORTAL_REM_ALIAS,
          action: 'portal.create',
          input: {
            parent_id: resolved.parentId,
            position: resolved.position,
            target_rem_id: `@${DURABLE_TARGET_ALIAS}`,
          },
        });
        break;
      }
      case 'after': {
        const resolved = yield* resolveAnchorPlacement({
          anchorRef: intent.portalPlacement.anchorRef,
          offset: 1,
        });
        actions.push({
          as: PORTAL_REM_ALIAS,
          action: 'portal.create',
          input: {
            parent_id: resolved.parentId,
            position: resolved.position,
            target_rem_id: `@${DURABLE_TARGET_ALIAS}`,
          },
        });
        break;
      }
      case 'in_place_selection_range': {
        if (intent.source.kind !== 'targets' || intent.source.sourceOrigin !== 'selection') {
          return yield* Effect.fail(
            invalidArgs('--leave-portal-in-place is only supported when the source is --from-selection'),
          );
        }
        const resolved = yield* resolveSelectionLayout({ remIds: intent.source.remIds });
        actions.push({
          as: PORTAL_REM_ALIAS,
          action: 'portal.create',
          input: {
            parent_id: resolved.parentId,
            position: resolved.position,
            target_rem_id: `@${DURABLE_TARGET_ALIAS}`,
          },
        });
        break;
      }
    }

    return actions;
  });
}

export function isMovePromotionMode(args: MovePromotionArgs): boolean {
  return Boolean(args.before || args.after || args.standalone || args.isDocument || args.leavePortal);
}

export function normalizeMovePromotionIntent(
  args: MovePromotionArgs,
): Effect.Effect<NormalizedMovePromotionIntent, CliError> {
  return Effect.gen(function* () {
    if (args.parent && args.ref) {
      return yield* Effect.fail(invalidArgs('Choose only one of --parent or --ref'));
    }

    if (args.position !== undefined && (!Number.isFinite(args.position) || args.position < 0)) {
      return yield* Effect.fail(
        invalidArgs('--position must be a non-negative integer', {
          position: args.position,
        }),
      );
    }

    const placementCount =
      (args.parent || args.ref ? 1 : 0) + (args.before ? 1 : 0) + (args.after ? 1 : 0) + (args.standalone ? 1 : 0);

    if (placementCount > 1) {
      return yield* Effect.fail(
        invalidArgs('Choose exactly one content placement: --parent/--ref, --before, --after, or --standalone'),
      );
    }

    if (placementCount === 0) {
      return yield* Effect.fail(
        invalidArgs('You must provide one content placement: --parent/--ref, --before, --after, or --standalone'),
      );
    }

    if (args.position !== undefined && !(args.parent || args.ref)) {
      return yield* Effect.fail(invalidArgs('--position is only supported with --parent or --ref'));
    }

    const contentPlacement: PromotionPlacement = (() => {
      if (args.parent || args.ref) {
        return {
          kind: 'parent',
          parentRef: normalizeRemIdInput(args.parent ?? args.ref ?? ''),
          ...(args.position !== undefined ? { position: args.position } : {}),
        };
      }
      if (args.before) return { kind: 'before', anchorRef: normalizeRemIdInput(args.before) };
      if (args.after) return { kind: 'after', anchorRef: normalizeRemIdInput(args.after) };
      return { kind: 'standalone' };
    })();

    return {
      remId: normalizeRemIdInput(args.rem),
      contentPlacement,
      isDocument: args.isDocument,
      leavePortal: args.leavePortal,
    };
  });
}

export function buildMovePromotionActions(
  intent: NormalizedMovePromotionIntent,
): Effect.Effect<readonly Record<string, unknown>[], CliError, AppConfig | RefResolver | RemDb | WorkspaceBindings> {
  return Effect.gen(function* () {
    const input: Record<string, unknown> = {
      rem_id: intent.remId,
      ...(intent.isDocument ? { is_document: true } : {}),
      ...(intent.leavePortal ? { leave_portal: true } : {}),
    };

    switch (intent.contentPlacement.kind) {
      case 'parent':
        input.new_parent_id = yield* resolveParentTargetId(intent.contentPlacement.parentRef);
        if (intent.contentPlacement.position !== undefined) {
          input.position = intent.contentPlacement.position;
        }
        break;
      case 'standalone':
        input.standalone = true;
        break;
      case 'before': {
        const resolved = yield* resolveAnchorPlacement({
          anchorRef: intent.contentPlacement.anchorRef,
          offset: 0,
        });
        input.new_parent_id = resolved.parentId;
        input.position = resolved.position;
        break;
      }
      case 'after': {
        const resolved = yield* resolveAnchorPlacement({
          anchorRef: intent.contentPlacement.anchorRef,
          offset: 1,
        });
        input.new_parent_id = resolved.parentId;
        input.position = resolved.position;
        break;
      }
    }

    return [
      {
        action: 'rem.move',
        input,
      },
    ];
  });
}
