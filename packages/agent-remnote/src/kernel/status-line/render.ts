import type { StatusLineModel } from './model.js';

function baseFragment(model: StatusLineModel): string {
  switch (model.connection) {
    case 'off':
      return 'OFF';
    case 'down':
    case 'stale':
      return 'WSx';
    case 'ok': {
      const sel = model.selection;
      if (sel.kind === 'text') return 'TXT';
      if (sel.kind === 'rem') {
        const n = Number.isFinite(sel.count) && sel.count > 0 ? Math.floor(sel.count) : 0;
        return n > 0 ? `${n} rems` : 'RN';
      }
      return 'RN';
    }
    case 'no_client':
      return '';
  }
}

export function renderStatusLine(model: StatusLineModel): string {
  const base = baseFragment(model).trim();
  const outstanding =
    Number.isFinite(model.queueOutstanding) && model.queueOutstanding > 0 ? Math.floor(model.queueOutstanding) : 0;
  const queue = outstanding > 0 ? `↓${outstanding}` : '';

  if (queue && base) return `${base} ${queue}`;
  if (queue) return queue;
  return base;
}

