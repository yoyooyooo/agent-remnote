import { spawn, spawnSync } from 'node:child_process';

function envTmuxRefreshEnabled(): boolean {
  const raw = String(process.env.REMNOTE_TMUX_REFRESH || process.env.TMUX_REFRESH || '')
    .trim()
    .toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true;
  return true;
}

function envTmuxRefreshMinIntervalMs(): number {
  const raw = process.env.REMNOTE_TMUX_REFRESH_MIN_INTERVAL_MS || process.env.TMUX_REFRESH_MIN_INTERVAL_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.min(10_000, Math.floor(n));
  return 250;
}

function listClients(): string[] | null {
  try {
    const res = spawnSync('tmux', ['list-clients', '-F', '#{client_name}'], { encoding: 'utf8' });
    if ((res as any).error) return null;
    if (res.status !== 0) return null;
    const stdout = typeof res.stdout === 'string' ? res.stdout : '';
    const clients = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return clients.length > 0 ? clients : null;
  } catch {
    return null;
  }
}

function refreshNow(): void {
  if (!envTmuxRefreshEnabled()) return;
  const clients = listClients();
  try {
    if (clients) {
      for (const clientName of clients) {
        const child = spawn('tmux', ['refresh-client', '-S', '-t', clientName], { stdio: 'ignore' });
        child.on('error', () => {});
        child.unref();
      }
      return;
    }

    const fallback = spawn('tmux', ['refresh-client', '-S'], { stdio: 'ignore' });
    fallback.on('error', () => {});
    fallback.unref();
  } catch {}
}

let refreshTimer: NodeJS.Timeout | null = null;
let refreshPending = false;
let lastRefreshAt = 0;

export type TmuxStatusLineRefreshMode = 'coalesced' | 'immediate';

export function requestTmuxStatusLineRefresh(mode: TmuxStatusLineRefreshMode = 'coalesced'): void {
  if (!envTmuxRefreshEnabled()) return;

  if (mode === 'immediate') {
    refreshNow();
    return;
  }

  refreshPending = true;
  if (refreshTimer) return;

  const minIntervalMs = envTmuxRefreshMinIntervalMs();
  const now = Date.now();
  const elapsed = now - lastRefreshAt;
  const delay = elapsed >= minIntervalMs ? 0 : minIntervalMs - elapsed;

  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (!refreshPending) return;
    refreshPending = false;
    lastRefreshAt = Date.now();
    refreshNow();
    if (refreshPending) requestTmuxStatusLineRefresh('coalesced');
  }, delay);

  refreshTimer.unref?.();
}

export function refreshTmuxStatusLine(): void {
  requestTmuxStatusLineRefresh('immediate');
}
