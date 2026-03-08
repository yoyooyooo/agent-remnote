import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import type { BetterSqliteInstance } from '../../../adapters/core.js';

import { AppConfig } from '../../../services/AppConfig.js';
import { HostApiClient } from '../../../services/HostApiClient.js';
import type { CliError } from '../../../services/Errors.js';
import { RemDb } from '../../../services/RemDb.js';

import { remnoteDbPathForWorkspaceId } from '../../../lib/remnote.js';
import { writeFailure, writeSuccess } from '../../_shared.js';
import { loadBridgeSelectionSnapshot } from '../selection/_shared.js';
import { loadBridgeUiContextSnapshot } from './_shared.js';

function optionToUndefined<A>(opt: Option.Option<A>): A | undefined {
  return Option.isSome(opt) ? opt.value : undefined;
}

const stateFile = Options.text('state-file').pipe(Options.optional, Options.map(optionToUndefined));
const staleMs = Options.integer('stale-ms').pipe(Options.optional, Options.map(optionToUndefined));
const selectionLimit = Options.integer('selection-limit').pipe(Options.withDefault(5));

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}…`;
}

function pickTitle(kt: unknown, ke: unknown, r: unknown): string {
  const combined = [kt, ke].map(normalizeText).filter(Boolean).join(' | ');

  const raw = combined || normalizeText(r);
  if (!raw) return '';

  const normalized = raw.replace(/\s+/g, ' ').trim();
  const title = normalized.split(/\n| - |——|。|！|？|\.|: /)[0]?.trim() || normalized;
  return truncateText(title, 80);
}

function uniqueNonEmpty(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? '').trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function fetchRemTitleMap(db: BetterSqliteInstance, ids: readonly string[]): Map<string, string> {
  const unique = uniqueNonEmpty(ids);
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

type PortalKind = 'page' | 'portal' | 'unknown';

function computePortalKind(pageRemId: string, focusedPortalId: string): PortalKind {
  const pageId = pageRemId.trim();
  const portalId = focusedPortalId.trim();
  if (pageId && portalId && pageId === portalId) return 'page';
  if (portalId) return 'portal';
  if (pageId) return 'page';
  return 'unknown';
}

function formatIdToken(id: string): string {
  const trimmed = id.trim();
  return trimmed ? `[id=${trimmed}]` : '';
}

export const readUiContextDescribeCommand = Command.make(
  'describe',
  { stateFile, staleMs, selectionLimit },
  ({ stateFile, staleMs, selectionLimit }) =>
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const remDb = yield* RemDb;
      const hostApi = yield* HostApiClient;

      if (cfg.apiBaseUrl) {
        const data = yield* hostApi.uiContextDescribe({ baseUrl: cfg.apiBaseUrl, stateFile, staleMs, selectionLimit });
        const ids = uniqueNonEmpty([data.portal?.id, data.page?.id, data.focus?.id, data.anchor?.id].filter(Boolean));
        const mdLines: string[] = [];
        mdLines.push(
          `Portal: ${data.portal?.title ? `(${data.portal.kind}) ${data.portal.title} [id=${data.portal.id}]` : data.portal?.id ? `(${data.portal.kind}) [id=${data.portal.id}]` : '(unavailable)'}`,
        );
        mdLines.push(
          `Page: ${data.page?.title ? `${data.page.title} [id=${data.page.id}]` : data.page?.id ? `[id=${data.page.id}]` : '(unavailable)'}`,
        );
        mdLines.push(
          `Focus: ${data.focus?.title ? `${data.focus.title} [id=${data.focus.id}]` : data.focus?.id ? `[id=${data.focus.id}]` : '(none)'}`,
        );
        if (!data.focus?.id && data.anchor?.source && data.anchor?.source !== 'none') {
          mdLines.push(
            `Anchor: (${data.anchor.source}) ${data.anchor?.title ? `${data.anchor.title} [id=${data.anchor.id}]` : `[id=${data.anchor.id}]`}`,
          );
        }
        if (data.selection_items?.kind === 'none' || !data.selection_items?.total_count)
          mdLines.push('Selection: (none)');
        else
          mdLines.push(
            `Selection: ${data.selection_items.total_count}${data.selection_items.truncated ? ' (truncated)' : ''}`,
          );
        yield* writeSuccess({ data, ids, md: `${mdLines.join('\n')}\n` });
        return;
      }

      const uiSnapshot = loadBridgeUiContextSnapshot({ stateFile, staleMs });
      const selectionSnapshot = loadBridgeSelectionSnapshot({ stateFile, staleMs });

      const ui = uiSnapshot.ui_context;
      const selection = selectionSnapshot.selection;

      const pageRemId = normalizeText(ui?.pageRemId);
      const focusedPortalId = normalizeText(ui?.focusedPortalId);
      const focusedRemId = normalizeText(ui?.focusedRemId);
      const kind = computePortalKind(pageRemId, focusedPortalId);

      const selectionKind = selection?.kind ?? 'none';
      const selectionIds = uniqueNonEmpty(selection?.kind === 'rem' ? selection.remIds.map(String) : []);
      const selectionTotalCountRaw =
        selection?.kind === 'rem' ? Number(selection.totalCount ?? 0) : selection?.kind === 'text' ? 1 : 0;
      const selectionTotalCount =
        Number.isFinite(selectionTotalCountRaw) && selectionTotalCountRaw >= 0 ? Math.floor(selectionTotalCountRaw) : 0;
      const selectionTruncated = selection?.kind === 'rem' ? selection.truncated === true : false;
      const selectionTextRemId = selection?.kind === 'text' ? normalizeText(selection.remId) : '';
      const selectionTextRange =
        selection?.kind === 'text'
          ? {
              start: Number.isFinite(selection.range?.start) ? Math.floor(selection.range.start) : NaN,
              end: Number.isFinite(selection.range?.end) ? Math.floor(selection.range.end) : NaN,
              isReverse: selection.isReverse === true,
            }
          : null;

      const anchorSource: 'focus' | 'selection' | 'none' = focusedRemId
        ? 'focus'
        : selection?.kind === 'rem' && selectionIds.length > 0
          ? 'selection'
          : selection?.kind === 'text' && selectionTextRemId
            ? 'selection'
            : 'none';
      const anchorRemId =
        anchorSource === 'focus'
          ? focusedRemId
          : anchorSource === 'selection'
            ? selection?.kind === 'rem'
              ? selectionIds[0] || ''
              : selection?.kind === 'text'
                ? selectionTextRemId
                : ''
            : '';
      const selectionLimitEffective = clampInt(selectionLimit, 0, 50);
      const selectionShownIds = selectionLimitEffective > 0 ? selectionIds.slice(0, selectionLimitEffective) : [];

      const idsToResolve = uniqueNonEmpty([
        pageRemId,
        focusedPortalId,
        focusedRemId,
        anchorRemId,
        ...selectionShownIds,
      ]);

      const warnings: string[] = [];
      const dbPathCandidate =
        cfg.remnoteDb ||
        (() => {
          const kbId = normalizeText(ui?.kbId);
          return kbId ? remnoteDbPathForWorkspaceId(kbId) : undefined;
        })();

      const titles = yield* Effect.gen(function* () {
        if (!dbPathCandidate || idsToResolve.length === 0) return new Map<string, string>();

        const mapOrError = yield* remDb
          .withDb(dbPathCandidate, async (db) => fetchRemTitleMap(db, idsToResolve))
          .pipe(
            Effect.map((r) => r.result),
            Effect.catchAll((e: CliError) =>
              Effect.sync(() => {
                warnings.push(e.message);
                return new Map<string, string>();
              }),
            ),
          );

        return mapOrError;
      });

      const pageTitle = pageRemId ? titles.get(pageRemId) || '' : '';
      const portalEffectiveId = kind === 'page' ? pageRemId || focusedPortalId : focusedPortalId;
      const portalTitle =
        kind === 'page'
          ? pageRemId
            ? titles.get(pageRemId) || ''
            : ''
          : focusedPortalId
            ? titles.get(focusedPortalId) || ''
            : '';

      const portalContent = (() => {
        const parts: string[] = [];
        if (kind !== 'unknown') parts.push(`(${kind})`);
        if (portalTitle) parts.push(portalTitle);
        const idToken = formatIdToken(portalEffectiveId);
        if (idToken) parts.push(idToken);
        return parts.length === 0 ? '(unavailable)' : parts.join(' ');
      })();

      const pageContent = (() => {
        if (!pageRemId) return '(unavailable)';
        const parts: string[] = [];
        if (pageTitle) parts.push(pageTitle);
        const idToken = formatIdToken(pageRemId);
        if (idToken) parts.push(idToken);
        return parts.length === 0 ? '(unavailable)' : parts.join(' ');
      })();

      const focusTitle = focusedRemId ? titles.get(focusedRemId) || '' : '';
      const focusContent = (() => {
        if (!focusedRemId) return '(none)';
        const parts: string[] = [];
        if (focusTitle) parts.push(focusTitle);
        const idToken = formatIdToken(focusedRemId);
        if (idToken) parts.push(idToken);
        return parts.length === 0 ? '(unavailable)' : parts.join(' ');
      })();

      const anchorTitle = anchorRemId ? titles.get(anchorRemId) || '' : '';
      const anchorContent = (() => {
        if (!anchorRemId) return '(none)';
        const parts: string[] = [];
        parts.push(`(${anchorSource})`);
        if (anchorTitle) parts.push(anchorTitle);
        const idToken = formatIdToken(anchorRemId);
        if (idToken) parts.push(idToken);
        return parts.length === 0 ? '(unavailable)' : parts.join(' ');
      })();

      const mdLines: string[] = [];
      mdLines.push(`Portal: ${portalContent}`);
      mdLines.push(`Page: ${pageContent}`);
      mdLines.push(`Focus: ${focusContent}`);
      if (!focusedRemId && anchorSource !== 'none') {
        mdLines.push(`Anchor: ${anchorContent}`);
      }

      if (selectionKind === 'none' || selectionTotalCount <= 0) {
        mdLines.push('Selection: (none)');
      } else if (selectionKind === 'text') {
        const textTitle = selectionTextRemId ? titles.get(selectionTextRemId) || '' : '';
        const idToken = formatIdToken(selectionTextRemId);
        const rangePart =
          selectionTextRange && Number.isFinite(selectionTextRange.start) && Number.isFinite(selectionTextRange.end)
            ? `range=${selectionTextRange.start}-${selectionTextRange.end}`
            : '';
        const reversePart = selectionTextRange?.isReverse ? 'reverse=true' : '';
        const parts = [textTitle, idToken, rangePart, reversePart].filter(Boolean);
        mdLines.push(`Selection: (text) ${parts.join(' ').trim() || '(unavailable)'}`.trim());
      } else {
        const showSuffix =
          selectionShownIds.length > 0 && selectionTotalCount > selectionShownIds.length
            ? ` (showing ${selectionShownIds.length})`
            : '';
        mdLines.push(`Selection: ${selectionTotalCount}${selectionTruncated ? ' (truncated)' : ''}${showSuffix}`);

        for (let i = 0; i < selectionShownIds.length; i++) {
          const id = selectionShownIds[i]!;
          const title = truncateText(titles.get(id) || '', 50);
          const idToken = formatIdToken(id);
          const content = title ? `${title} ${idToken}`.trim() : idToken || `id:${id}`;
          mdLines.push(`Selection[${i + 1}]: ${content}`);
        }
      }

      const md = mdLines.join('\n');

      const data = {
        uiContext: uiSnapshot.ui_context ?? null,
        selection: selectionSnapshot.selection ?? null,
        ui_snapshot: uiSnapshot,
        selection_snapshot: selectionSnapshot,
        anchor: {
          source: anchorSource,
          id: anchorRemId,
          title: anchorTitle || undefined,
        },
        portal: {
          kind,
          id: portalEffectiveId,
          title: portalTitle || undefined,
        },
        page: {
          id: pageRemId,
          title: pageTitle || undefined,
        },
        focus: {
          id: focusedRemId,
          title: focusTitle || undefined,
        },
        selection_items: {
          kind: selectionKind,
          total_count: selectionTotalCount,
          truncated: selectionTruncated,
          limit: selectionLimitEffective,
          shown: selectionShownIds.map((id) => ({ id, title: titles.get(id) || undefined })),
        },
        ...(dbPathCandidate ? { remnote_db: dbPathCandidate } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      };

      const ids = uniqueNonEmpty([portalEffectiveId, pageRemId, focusedRemId, anchorRemId]);
      yield* writeSuccess({ data, ids, md });
    }).pipe(Effect.catchAll(writeFailure)),
);
