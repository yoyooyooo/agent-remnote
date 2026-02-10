import fs from 'node:fs';
import path from 'node:path';

import { homeDir, resolveUserFilePath } from './paths.js';

export function defaultStateFilePath(): string {
  return path.join(homeDir(), '.agent-remnote', 'ws.bridge.state.json');
}

export function resolveStateFilePath(explicit?: string): { readonly disabled: boolean; readonly path: string } {
  if (explicit && explicit.trim()) return { disabled: false, path: resolveUserFilePath(explicit) };

  const raw = String(process.env.REMNOTE_WS_STATE_FILE || process.env.WS_STATE_FILE || '').trim();
  if (raw === '0' || raw.toLowerCase() === 'false') return { disabled: true, path: defaultStateFilePath() };
  if (raw) return { disabled: false, path: resolveUserFilePath(raw) };
  return { disabled: false, path: defaultStateFilePath() };
}

export function readJson(filePath: string): any | null {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export function pickClient(clients: any[], connId?: string | undefined) {
  const target = (connId || '').trim();
  if (target) {
    const found = clients.find((c) => c && typeof c === 'object' && c.connId === target);
    if (found) return found;
  }

  const active = clients.find((c) => c && typeof c === 'object' && c.isActiveWorker === true);
  if (active) return active;

  let best: any | null = null;
  let bestScore = -1;
  for (const c of clients) {
    if (!c || typeof c !== 'object') continue;
    const selAt = Number(c.selection?.updatedAt ?? 0);
    const ctxAt = Number(c.uiContext?.updatedAt ?? 0);
    // IMPORTANT: Do NOT include lastSeenAt in ordering; heartbeats would cause selection flapping.
    const score = Math.max(selAt, ctxAt);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export function resolveStaleMs(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const raw = process.env.REMNOTE_WS_STATE_STALE_MS || process.env.WS_STATE_STALE_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 60_000;
}
