import * as Effect from 'effect/Effect';

import { looksLikeStructuredMarkdown, trimBoundaryBlankLines } from '../../../lib/text.js';
import { readSingleRemTitle } from '../../../lib/business-semantics/titleInference.js';
import { CliError } from '../../../services/Errors.js';
import type { FileInput } from '../../../services/FileInput.js';
import { RefResolver } from '../../../services/RefResolver.js';
import { WorkspaceBindings } from '../../../services/WorkspaceBindings.js';

import { type PlacementSpec, fetchRemLayouts, listSiblingOrder, parsePlacementSpec, resolveLocalDbPath, resolvePlacementSpec } from '../_placementSpec.js';
import { type PortalStrategy, parsePortalStrategy } from '../_portalStrategy.js';
import { resolveRefValue } from '../_refValue.js';
import { invalidArgs, normalizeOptionalText, requireStableSiblingRange, resolveCreateDestinationTitle } from '../_shared.js';
import { readMarkdownArg, resolveCurrentSelectionRemIds } from './children/common.js';

export const DURABLE_TARGET_ALIAS = 'durable_target';
export const PORTAL_REM_ALIAS = 'portal_rem';

type StableSiblingRange = {
  readonly orderedRemIds: readonly string[];
  readonly parentId: string;
  readonly position: number;
};

export type CreatePromotionContentSource =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'markdown'; readonly markdown: string }
  | {
      readonly kind: 'targets';
      readonly remIds: readonly string[];
      readonly sourceOrigin: 'explicit_from' | 'selection';
    };

export type PromotionPortalPlacement =
  | { readonly kind: 'none' }
  | { readonly kind: 'parent'; readonly parentRef: string }
  | { readonly kind: 'before'; readonly anchorRef: string }
  | { readonly kind: 'after'; readonly anchorRef: string }
  | { readonly kind: 'in_place_selection_range'; readonly parentId: string; readonly position: number };

export type MovePortalPlacement =
  | { readonly kind: 'none' }
  | { readonly kind: 'in_place_single_rem' }
  | { readonly kind: 'parent'; readonly parentRef: string }
  | { readonly kind: 'before'; readonly anchorRef: string }
  | { readonly kind: 'after'; readonly anchorRef: string };

export type NormalizedCreatePromotionIntent = {
  readonly source: CreatePromotionContentSource;
  readonly contentPlacement: PlacementSpec;
  readonly portalPlacement: PromotionPortalPlacement;
  readonly destinationTitle: string;
  readonly isDocument: boolean;
  readonly tags: readonly string[];
  readonly hasBodyTextChild: boolean;
};

export type CreatePromotionArgs = {
  readonly at: string;
  readonly text?: string | undefined;
  readonly markdown?: string | undefined;
  readonly from: readonly string[];
  readonly fromSelection: boolean;
  readonly title?: string | undefined;
  readonly isDocument: boolean;
  readonly tag: readonly string[];
  readonly forceText: boolean;
  readonly portal?: string | undefined;
};

export type MovePromotionArgs = {
  readonly subject: string;
  readonly at: string;
  readonly isDocument: boolean;
  readonly portal?: string | undefined;
};

export type NormalizedMovePromotionIntent = {
  readonly remId: string;
  readonly contentPlacement: PlacementSpec;
  readonly isDocument: boolean;
  readonly portalPlacement: MovePortalPlacement;
};

function convertPortalAtPlacement(strategy: PortalStrategy): Effect.Effect<Exclude<PromotionPortalPlacement, { kind: 'none' } | { kind: 'in_place_selection_range' }>, CliError> {
  return Effect.gen(function* () {
    if (strategy.kind !== 'at' || strategy.placement.kind === 'standalone') {
      return yield* Effect.fail(invalidArgs('Invalid --portal strategy', { portal: strategy }));
    }

    switch (strategy.placement.kind) {
      case 'parent':
        return { kind: 'parent', parentRef: strategy.placement.parentRef } as const;
      case 'before':
        return { kind: 'before', anchorRef: strategy.placement.anchorRef } as const;
      case 'after':
        return { kind: 'after', anchorRef: strategy.placement.anchorRef } as const;
    }
  });
}

function convertMovePortalPlacement(strategy: PortalStrategy): Effect.Effect<MovePortalPlacement, CliError> {
  return Effect.gen(function* () {
    if (strategy.kind === 'none') return { kind: 'none' } as const;
    if (strategy.kind === 'in_place') return { kind: 'in_place_single_rem' } as const;
    const converted = yield* convertPortalAtPlacement(strategy);
    return converted;
  });
}

function normalizeExplicitFromSource(params: {
  readonly remIds: readonly string[];
  readonly requireInPlaceRange: boolean;
}): Effect.Effect<
  { readonly orderedRemIds: readonly string[]; readonly inPlaceRange?: StableSiblingRange | undefined },
  CliError,
  any
> {
  return Effect.gen(function* () {
    const uniqueRemIds = Array.from(new Set(params.remIds.map((id) => String(id ?? '').trim()).filter(Boolean)));
    if (uniqueRemIds.length === 0) {
      return { orderedRemIds: [] } as const;
    }

    if (params.requireInPlaceRange) {
      const range = yield* requireStableSiblingRange({
        remIds: uniqueRemIds,
        missingMessage: 'Explicit --from refs could not be fully resolved from the local RemNote DB',
        mismatchMessage: 'Explicit --from refs must resolve to contiguous sibling Rems under the same parent for --portal in-place',
      });
      return {
        orderedRemIds: range.orderedRemIds,
        inPlaceRange: range,
      };
    }

    const maybeRange = yield* requireStableSiblingRange({
      remIds: uniqueRemIds,
      missingMessage: 'Explicit --from refs could not be fully resolved from the local RemNote DB',
      mismatchMessage: 'Explicit --from refs are not one contiguous sibling range under the same parent',
    }).pipe(Effect.option);

    if (maybeRange._tag === 'Some') {
      return { orderedRemIds: maybeRange.value.orderedRemIds } as const;
    }

    return { orderedRemIds: uniqueRemIds } as const;
  });
}

function addResolvedPlacementToInput(input: Record<string, unknown>, placement: { readonly kind: string; readonly parentId?: string; readonly position?: number }): void {
  if (placement.kind === 'standalone') {
    input.standalone = true;
    return;
  }

  if (typeof placement.parentId === 'string' && placement.parentId.trim()) {
    input.parent_id = placement.parentId;
  }
  if (typeof placement.position === 'number') {
    input.position = placement.position;
  }
}

export function normalizeCreatePromotionIntent(
  args: CreatePromotionArgs,
): Effect.Effect<NormalizedCreatePromotionIntent, CliError, any> {
  return Effect.gen(function* () {
    const contentPlacement = yield* Effect.gen(function* () {
      return yield* parsePlacementSpec(args.at, { optionName: '--at' });
    });

    const portalStrategy = yield* parsePortalStrategy(args.portal);

    const textValue = args.text !== undefined ? trimBoundaryBlankLines(args.text) : undefined;
    const hasTextSource = textValue !== undefined;
    const hasMarkdownSource = normalizeOptionalText(args.markdown) !== undefined;
    const resolvedExplicitFrom = yield* Effect.forEach(args.from, (value) => resolveRefValue(value));
    const hasExplicitFrom = resolvedExplicitFrom.length > 0;
    const hasSelectionSource = args.fromSelection === true;
    const sourceCount =
      (hasTextSource ? 1 : 0) + (hasMarkdownSource ? 1 : 0) + (hasExplicitFrom ? 1 : 0) + (hasSelectionSource ? 1 : 0);

    if (sourceCount > 1) {
      return yield* Effect.fail(
        invalidArgs('Choose exactly one content source: --text, --markdown, repeated --from, or --from-selection'),
      );
    }
    if (sourceCount === 0) {
      return yield* Effect.fail(
        invalidArgs('You must provide one content source: --text, --markdown, repeated --from, or --from-selection'),
      );
    }

    const title = normalizeOptionalText(args.title);
    if (hasMarkdownSource && !title) {
      return yield* Effect.fail(invalidArgs('rem create --markdown requires --title'));
    }

    if (hasSelectionSource && (hasTextSource || hasMarkdownSource || hasExplicitFrom)) {
      return yield* Effect.fail(
        invalidArgs('--from-selection cannot be combined with --text, --markdown, or explicit --from'),
      );
    }

    if (hasTextSource && textValue && !args.forceText && looksLikeStructuredMarkdown(textValue)) {
      return yield* Effect.fail(
        invalidArgs(
          'Input passed to --text looks like structured Markdown. Use --markdown instead, or pass --force-text to keep it literal.',
        ),
      );
    }

    if (portalStrategy.kind === 'in_place' && (hasTextSource || hasMarkdownSource)) {
      return yield* Effect.fail(
        invalidArgs('--portal in-place is only supported with --from-selection or repeated --from'),
      );
    }

    const tags = yield* Effect.forEach(args.tag, (value) => resolveRefValue(value)).pipe(
      Effect.map((values) => values.filter(Boolean)),
    );

    if (hasMarkdownSource) {
      const markdown = yield* readMarkdownArg(args.markdown!);
      const portalPlacement: PromotionPortalPlacement =
        portalStrategy.kind === 'none' ? ({ kind: 'none' } as const) : yield* convertPortalAtPlacement(portalStrategy);
      return {
        source: { kind: 'markdown', markdown },
        contentPlacement,
        portalPlacement,
        destinationTitle: title!,
        isDocument: args.isDocument,
        tags,
        hasBodyTextChild: false,
      };
    }

    if (hasSelectionSource) {
      const resolvedSelection = yield* resolveCurrentSelectionRemIds({});
      const selectionRange = yield* requireStableSiblingRange({
        remIds: resolvedSelection.rem_ids,
        missingMessage: 'Current selection could not be fully resolved from the local RemNote DB',
        mismatchMessage: 'Current selection must resolve to contiguous sibling Rems under the same parent',
      });

      const inferredTitle = !title
        ? yield* readSingleRemTitle({
            ids: selectionRange.orderedRemIds,
            selectionTitle:
              selectionRange.orderedRemIds.length === 1 &&
              String((resolvedSelection as any)?.selection?.current?.id ?? '').trim() === selectionRange.orderedRemIds[0]
                ? normalizeOptionalText(String((resolvedSelection as any)?.selection?.current?.title ?? ''))
                : undefined,
          })
        : undefined;
      const destinationTitle = yield* resolveCreateDestinationTitle({
        explicitTitle: title,
        inferredTitle,
        sourceKind: 'selection',
        sourceCount: selectionRange.orderedRemIds.length,
      });

      const portalPlacement: PromotionPortalPlacement =
        portalStrategy.kind === 'in_place'
          ? {
              kind: 'in_place_selection_range',
              parentId: selectionRange.parentId,
              position: selectionRange.position,
            }
          : portalStrategy.kind === 'none'
            ? ({ kind: 'none' } as const)
            : yield* convertPortalAtPlacement(portalStrategy);

      return {
        source: { kind: 'targets', remIds: selectionRange.orderedRemIds, sourceOrigin: 'selection' },
        contentPlacement,
        portalPlacement,
        destinationTitle,
        isDocument: args.isDocument,
        tags,
        hasBodyTextChild: false,
      };
    }

    if (hasExplicitFrom) {
      const explicitSource = yield* normalizeExplicitFromSource({
        remIds: resolvedExplicitFrom,
        requireInPlaceRange: portalStrategy.kind === 'in_place',
      });
      const inferredTitle = !title ? yield* readSingleRemTitle({ ids: explicitSource.orderedRemIds }) : undefined;
      const destinationTitle = yield* resolveCreateDestinationTitle({
        explicitTitle: title,
        inferredTitle,
        sourceKind: 'explicit_from',
        sourceCount: explicitSource.orderedRemIds.length,
      });

      const portalPlacement: PromotionPortalPlacement =
        portalStrategy.kind === 'in_place'
          ? {
              kind: 'in_place_selection_range',
              parentId: explicitSource.inPlaceRange!.parentId,
              position: explicitSource.inPlaceRange!.position,
            }
          : portalStrategy.kind === 'none'
            ? ({ kind: 'none' } as const)
            : yield* convertPortalAtPlacement(portalStrategy);

      return {
        source: { kind: 'targets', remIds: explicitSource.orderedRemIds, sourceOrigin: 'explicit_from' },
        contentPlacement,
        portalPlacement,
        destinationTitle,
        isDocument: args.isDocument,
        tags,
        hasBodyTextChild: false,
      };
    }

    const normalizedText = textValue ?? '';
    const portalPlacement: PromotionPortalPlacement =
      portalStrategy.kind === 'none' ? ({ kind: 'none' } as const) : yield* convertPortalAtPlacement(portalStrategy);
    return {
      source: { kind: 'text', text: normalizedText },
      contentPlacement,
      portalPlacement,
      destinationTitle: title ?? normalizedText,
      isDocument: args.isDocument,
      tags,
      hasBodyTextChild: Boolean(title),
    };
  });
}

export function buildCreatePromotionActions(
  intent: NormalizedCreatePromotionIntent,
): Effect.Effect<readonly Record<string, unknown>[], CliError, any> {
  return Effect.gen(function* () {
    const resolvedContentPlacement = yield* resolvePlacementSpec(intent.contentPlacement);
    const destinationInput: Record<string, unknown> = {
      text: intent.destinationTitle,
      ...(intent.isDocument ? { is_document: true } : {}),
      ...(intent.tags.length > 0 ? { tags: intent.tags } : {}),
    };
    addResolvedPlacementToInput(destinationInput, resolvedContentPlacement);

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
            parent_id: yield* resolveRefValue(intent.portalPlacement.parentRef),
            target_rem_id: `@${DURABLE_TARGET_ALIAS}`,
          },
        });
        break;
      case 'before': {
        const resolved = yield* resolvePlacementSpec({ kind: 'before', anchorRef: intent.portalPlacement.anchorRef });
        if (resolved.kind === 'standalone') {
          return yield* Effect.fail(invalidArgs('Invalid portal placement'));
        }
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
        const resolved = yield* resolvePlacementSpec({ kind: 'after', anchorRef: intent.portalPlacement.anchorRef });
        if (resolved.kind === 'standalone') {
          return yield* Effect.fail(invalidArgs('Invalid portal placement'));
        }
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
      case 'in_place_selection_range':
        actions.push({
          as: PORTAL_REM_ALIAS,
          action: 'portal.create',
          input: {
            parent_id: intent.portalPlacement.parentId,
            position: intent.portalPlacement.position,
            target_rem_id: `@${DURABLE_TARGET_ALIAS}`,
          },
        });
        break;
    }

    return actions;
  });
}

export function normalizeMovePromotionIntent(
  args: MovePromotionArgs,
): Effect.Effect<NormalizedMovePromotionIntent, CliError, any> {
  return Effect.gen(function* () {
    const contentPlacement = yield* Effect.gen(function* () {
      return yield* parsePlacementSpec(args.at, { optionName: '--at' });
    });
    const portalPlacement = yield* parsePortalStrategy(args.portal).pipe(Effect.flatMap(convertMovePortalPlacement));

    return {
      remId: yield* resolveRefValue(args.subject),
      contentPlacement,
      isDocument: args.isDocument,
      portalPlacement,
    };
  });
}

export function buildMovePromotionActions(
  intent: NormalizedMovePromotionIntent,
): Effect.Effect<readonly Record<string, unknown>[], CliError, any> {
  return Effect.gen(function* () {
    const resolvedContentPlacement = yield* resolvePlacementSpec(intent.contentPlacement);
    const moveInput: Record<string, unknown> = {
      rem_id: intent.remId,
      ...(intent.isDocument ? { is_document: true } : {}),
      ...(intent.portalPlacement.kind === 'in_place_single_rem' ? { leave_portal: true } : {}),
    };

    if (resolvedContentPlacement.kind === 'standalone') {
      moveInput.standalone = true;
    } else {
      moveInput.new_parent_id = resolvedContentPlacement.parentId;
      if (resolvedContentPlacement.position !== undefined) {
        moveInput.position = resolvedContentPlacement.position;
      }
    }

    const actions: Record<string, unknown>[] = [
      {
        action: 'rem.move',
        input: moveInput,
      },
    ];

    switch (intent.portalPlacement.kind) {
      case 'none':
      case 'in_place_single_rem':
        break;
      case 'parent':
        actions.push({
          as: PORTAL_REM_ALIAS,
          action: 'portal.create',
          input: {
            parent_id: yield* resolveRefValue(intent.portalPlacement.parentRef),
            target_rem_id: intent.remId,
          },
        });
        break;
      case 'before': {
        const resolved = yield* resolvePlacementSpec({ kind: 'before', anchorRef: intent.portalPlacement.anchorRef });
        if (resolved.kind === 'standalone') {
          return yield* Effect.fail(invalidArgs('Invalid portal placement'));
        }
        actions.push({
          as: PORTAL_REM_ALIAS,
          action: 'portal.create',
          input: {
            parent_id: resolved.parentId,
            position: resolved.position,
            target_rem_id: intent.remId,
          },
        });
        break;
      }
      case 'after': {
        const resolved = yield* resolvePlacementSpec({ kind: 'after', anchorRef: intent.portalPlacement.anchorRef });
        if (resolved.kind === 'standalone') {
          return yield* Effect.fail(invalidArgs('Invalid portal placement'));
        }
        actions.push({
          as: PORTAL_REM_ALIAS,
          action: 'portal.create',
          input: {
            parent_id: resolved.parentId,
            position: resolved.position,
            target_rem_id: intent.remId,
          },
        });
        break;
      }
    }

    return actions;
  });
}
