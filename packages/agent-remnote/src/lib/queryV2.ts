import * as Effect from 'effect/Effect';

import { resolvePowerup } from '../commands/_powerup.js';
import { AppConfig } from '../services/AppConfig.js';
import { CliError } from '../services/Errors.js';
import { HostApiClient } from '../services/HostApiClient.js';

export type QueryPowerupResolution = {
  readonly id: string;
  readonly rcrt: string;
  readonly title: string;
};

type QueryLeaf = Record<string, unknown>;

type QueryCommandArgs = {
  readonly payload?: string;
  readonly text?: string;
  readonly tags: readonly string[];
  readonly powerup?: string;
  readonly sort?: 'rank' | 'updatedAt' | 'createdAt';
  readonly sortDirection?: 'asc' | 'desc';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePowerupValue(by: string, value: string): string {
  if (by === 'rcrt' && /^todo$/i.test(value.trim())) return 't';
  return value.trim();
}

function normalizeQueryRoot(root: Record<string, unknown>): Record<string, unknown> {
  const type = typeof root.type === 'string' ? root.type.trim() : '';

  if (type === 'text') {
    return {
      type,
      value: String(root.value ?? '').trim(),
      mode: typeof root.mode === 'string' && root.mode.trim() ? root.mode.trim() : 'contains',
    };
  }

  if (type === 'powerup') {
    const powerup = isRecord(root.powerup) ? root.powerup : {};
    const by = typeof powerup.by === 'string' ? powerup.by.trim().toLowerCase() : 'rcrt';
    if (by !== 'id' && by !== 'rcrt') {
      throw new CliError({
        code: 'INVALID_PAYLOAD',
        message: 'Query V2 powerup.by must be "id" or "rcrt"',
        exitCode: 2,
      });
    }
    return {
      type,
      powerup: {
        by,
        value: normalizePowerupValue(by, String(powerup.value ?? '')),
      },
    };
  }

  if ((type === 'and' || type === 'or') && Array.isArray(root.nodes)) {
    return {
      type,
      nodes: root.nodes.map((node) => normalizeQueryRoot(isRecord(node) ? node : {})),
    };
  }

  if (type === 'not') {
    return {
      type,
      node: normalizeQueryRoot(isRecord(root.node) ? root.node : {}),
    };
  }

  return root;
}

export function normalizeCanonicalQuery(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    throw new CliError({
      code: 'INVALID_PAYLOAD',
      message: 'Query payload must be an object',
      exitCode: 2,
    });
  }

  let query = raw;
  if (isRecord(raw.queryObj)) {
    query = raw.queryObj;
  }
  if (isRecord(query.query)) {
    query = query.query;
  }
  if (!isRecord(query.root) && isRecord(raw.root)) {
    query = raw;
  }
  const root = isRecord(query.root) ? query.root : isRecord(raw.root) ? raw.root : query;
  if (!isRecord(root) || typeof root.type !== 'string') {
    throw new CliError({
      code: 'INVALID_PAYLOAD',
      message: 'Invalid payload shape: expected canonical Query V2 or a legacy object with root/query/queryObj',
      exitCode: 2,
    });
  }

  const out: Record<string, unknown> = {
    version: 2,
    root: normalizeQueryRoot(root),
  };
  if (isRecord(query.scope)) out.scope = query.scope;
  if (isRecord(query.shape)) out.shape = query.shape;
  if (isRecord(query.sort)) out.sort = query.sort;
  return out;
}

export function normalizeCanonicalQueryRequest(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    throw new CliError({
      code: 'INVALID_PAYLOAD',
      message: 'Query request payload must be an object',
      exitCode: 2,
    });
  }

  if (isRecord(raw.query) && isRecord(raw.query.root)) {
    return {
      query: normalizeCanonicalQuery(raw.query),
      ...(raw.limit !== undefined ? { limit: raw.limit } : {}),
      ...(raw.offset !== undefined ? { offset: raw.offset } : {}),
      ...(raw.snippetLength !== undefined ? { snippetLength: raw.snippetLength } : {}),
    };
  }

  if (isRecord(raw.queryObj) || isRecord(raw.root) || isRecord(raw.query)) {
    return {
      query: normalizeCanonicalQuery(raw),
      ...(raw.limit !== undefined ? { limit: raw.limit } : {}),
      ...(raw.offset !== undefined ? { offset: raw.offset } : {}),
      ...(raw.snippetLength !== undefined ? { snippetLength: raw.snippetLength } : {}),
    };
  }

  if (isRecord(raw.root)) {
    return { query: normalizeCanonicalQuery(raw) };
  }

  throw new CliError({
    code: 'INVALID_PAYLOAD',
    message: 'Invalid query request payload',
    exitCode: 2,
  });
}

export function renderQuerySort(sort?: 'rank' | 'updatedAt' | 'createdAt', direction?: 'asc' | 'desc') {
  if (sort === 'rank') return { mode: 'rank' };
  if (sort === 'updatedAt') return { mode: 'updatedAt', direction: direction ?? 'desc' };
  if (sort === 'createdAt') return { mode: 'createdAt', direction: direction ?? 'desc' };
  return undefined;
}

function isExactNotFound(error: CliError): boolean {
  return (
    error.code === 'INVALID_ARGS' &&
    (error.message.startsWith('Powerup not found by id:') ||
      error.message.startsWith('Powerup not found by code:') ||
      error.message.startsWith('Powerup not found by title:'))
  );
}

function resolveQueryPowerupLocally(
  powerup: string,
): Effect.Effect<QueryPowerupResolution, CliError, AppConfig | any> {
  return Effect.gen(function* () {
    const explicit = powerup.trim();
    if (/^(id|code|title)\s*:/i.test(explicit)) {
      const resolved = yield* resolvePowerup(explicit);
      return {
        id: resolved.id,
        rcrt: resolved.rcrt,
        title: resolved.title,
      };
    }

    const candidates = [`id:${explicit}`, `code:${explicit}`, `title:${explicit}`] as const;
    let lastNotFound: CliError | null = null;
    for (const candidate of candidates) {
      const attempt = yield* resolvePowerup(candidate).pipe(Effect.either);
      if (attempt._tag === 'Right') {
        return {
          id: attempt.right.id,
          rcrt: attempt.right.rcrt,
          title: attempt.right.title,
        };
      }
      const error = attempt.left;
      if (isExactNotFound(error)) {
        lastNotFound = error;
        continue;
      }
      return yield* Effect.fail(error);
    }

    return yield* Effect.fail(
      lastNotFound ??
        new CliError({
          code: 'INVALID_ARGS',
          message: `Powerup not found by exact id/code/title: ${explicit}`,
          exitCode: 2,
        }),
    );
  });
}

export function resolveQueryPowerupByName(
  powerup: string,
): Effect.Effect<QueryPowerupResolution, CliError, AppConfig | HostApiClient | any> {
  return Effect.gen(function* () {
    const cfg = yield* AppConfig;
    if (cfg.apiBaseUrl) {
      const hostApi = yield* HostApiClient;
      const resolved = yield* hostApi.resolveQueryPowerup({
        baseUrl: cfg.apiBaseUrl,
        powerup,
      });
      return {
        id: String((resolved as any)?.id ?? ''),
        rcrt: String((resolved as any)?.rcrt ?? ''),
        title: String((resolved as any)?.title ?? ''),
      };
    }

    return yield* resolveQueryPowerupLocally(powerup);
  });
}

export { resolveQueryPowerupLocally };

export function buildCanonicalQueryFromFilters(
  args: QueryCommandArgs,
  resolvedPowerup?: QueryPowerupResolution,
): Record<string, unknown> {
  const nodes: QueryLeaf[] = [];

  if (args.text && args.text.trim()) {
    nodes.push({ type: 'text', value: args.text.trim(), mode: 'contains' });
  }
  for (const tag of args.tags) {
    const value = tag.trim();
    if (value) nodes.push({ type: 'tag', id: value });
  }
  if (resolvedPowerup) {
    nodes.push({
      type: 'powerup',
      powerup: {
        by: 'id',
        value: resolvedPowerup.id,
      },
    });
  }
  if (nodes.length === 0) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: 'Provide --payload or at least one filter (e.g. --text / --tag / --powerup)',
      exitCode: 2,
    });
  }

  return {
    version: 2,
    root: nodes.length === 1 ? nodes[0] : { type: 'and', nodes },
    ...(renderQuerySort(args.sort, args.sortDirection) ? { sort: renderQuerySort(args.sort, args.sortDirection) } : {}),
  };
}
