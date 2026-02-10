import type { WsClientSelection, WsClientUiContext } from './model.js';

export function normalizeSelectionForUiContext(params: {
  readonly selection: WsClientSelection | undefined;
  readonly uiContext: WsClientUiContext | undefined;
  readonly now: number;
}): WsClientSelection | undefined {
  const selection = params.selection;
  const uiContext = params.uiContext;
  if (!selection || !uiContext) return selection;

  const focusedRemId = typeof uiContext.focusedRemId === 'string' ? uiContext.focusedRemId.trim() : '';
  if (!focusedRemId) return selection;

  if (selection.kind === 'text') {
    const remId = typeof selection.remId === 'string' ? selection.remId.trim() : '';
    const start = Number(selection.range?.start);
    const end = Number(selection.range?.end);
    if (!remId || !Number.isFinite(start) || !Number.isFinite(end) || start === end || remId !== focusedRemId) {
      return { kind: 'none', selectionType: undefined, updatedAt: params.now };
    }
    return selection;
  }

  if (selection.kind !== 'rem') return selection;

  const remIds = Array.isArray(selection.remIds)
    ? selection.remIds.filter((id) => typeof id === 'string' && id.trim())
    : [];
  if (remIds.length === 0) return selection;

  const totalCount = Number(selection.totalCount);
  const truncated = !!selection.truncated || (Number.isFinite(totalCount) && totalCount > remIds.length);

  // If selection is truncated, we cannot safely conclude whether focusedRemId is inside it.
  if (truncated) return selection;

  if (!remIds.includes(focusedRemId)) {
    return { kind: 'none', selectionType: undefined, updatedAt: params.now };
  }

  return selection;
}

