import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';
import { spawn, spawnSync } from 'node:child_process';

import { AppConfig } from './AppConfig.js';

export type TmuxRefreshMode = 'coalesced' | 'immediate';

export interface TmuxService {
  readonly requestRefresh: (mode?: TmuxRefreshMode) => Effect.Effect<void, never, AppConfig>;
}

export class Tmux extends Context.Tag('Tmux')<Tmux, TmuxService>() {}

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
  try {
    const clients = listClients();
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

export const TmuxLive = Layer.scoped(
  Tmux,
  Effect.gen(function* () {
    const state = yield* Ref.make({
      scheduled: false,
      pending: false,
      lastRefreshAt: 0,
    });

    const scheduleCoalesced = Effect.gen(function* () {
      while (true) {
        const cfg = yield* AppConfig;
        if (!cfg.tmuxRefresh) {
          yield* Ref.update(state, (s) => ({ ...s, scheduled: false, pending: false }));
          return;
        }

        const snap = yield* Ref.get(state);
        if (!snap.pending) {
          yield* Ref.update(state, (s) => ({ ...s, scheduled: false }));
          return;
        }

        const now = Date.now();
        const elapsed = now - snap.lastRefreshAt;
        const minIntervalMs = Math.max(0, cfg.tmuxRefreshMinIntervalMs);
        const delay = elapsed >= minIntervalMs ? 0 : minIntervalMs - elapsed;
        if (delay > 0) yield* Effect.sleep(delay);

        yield* Ref.update(state, (s) => ({ ...s, pending: false, lastRefreshAt: Date.now() }));
        yield* Effect.sync(() => refreshNow());
      }
    });

    return {
      requestRefresh: (mode = 'coalesced') =>
        Effect.gen(function* () {
          const cfg = yield* AppConfig;
          if (!cfg.tmuxRefresh) return;

          if (mode === 'immediate') {
            yield* Ref.update(state, (s) => ({ ...s, lastRefreshAt: Date.now(), pending: false }));
            yield* Effect.sync(() => refreshNow());
            return;
          }

          const snap = yield* Ref.get(state);
          if (snap.scheduled) {
            yield* Ref.update(state, (s) => ({ ...s, pending: true }));
            return;
          }

          yield* Ref.set(state, { ...snap, scheduled: true, pending: true });
          yield* Effect.fork(scheduleCoalesced);
        }),
    } satisfies TmuxService;
  }),
);
