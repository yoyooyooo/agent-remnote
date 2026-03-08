import { z, type ZodRawShape } from 'zod';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';

import { withResolvedDatabase, getDateFormatting, formatDateWithPattern, type BetterSqliteInstance } from './shared.js';
import { TIME_RANGE_PATTERN, timeValueSchema, resolveTimeFilters, type TimeFilters } from './timeFilters.js';
import { createPreview, coalesceText, stringifyAncestor } from './searchUtils.js';
import { parseOrThrow } from './shared.js';
import { runWorkerJob } from '../../services/WorkerRunner.js';

const SEARCH_MODE = z.enum(['auto', 'like', 'fts']);

const inputShape = {
  query: z.string().min(1, 'query is required').describe('Keywords (1-3 terms), case-insensitive fuzzy match'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results to return (default 10)'),
  timeoutMs: z.number().int().min(1).max(30_000).optional().describe('Hard timeout in ms (max 30000)'),
  mode: SEARCH_MODE.optional().describe('Search mode: auto/like/fts (default auto)'),
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
  useCurrentDate: z.boolean().optional().describe('Replace query with current date (use with dateOffsetDays)'),
  dateOffsetDays: z.number().int().optional().describe('Day offset relative to today (e.g. -1=yesterday)'),
  parentId: z.string().optional().describe('Limit to a parent Rem (or its subtree)'),
  // Page = top-level Rem (parentId is empty / depth=1)
  pagesOnly: z.boolean().optional().describe('Only return top-level Pages'),
  excludePages: z.boolean().optional().describe('Exclude top-level Pages'),
  // Prefer pinning results where title/alias equals query
  preferExact: z.boolean().optional().describe('Pin exact title/alias matches to the top (default true)'),
  // If exact hit, return only 1 item; otherwise return a small set (limit or default 5)
  exactFirstSingle: z.boolean().optional().describe('If exact hit, return only 1 item (default false)'),
  offset: z.number().int().min(0).optional().describe('Pagination offset'),
  snippetLength: z.number().int().min(30).max(400).optional().describe('Snippet length (characters)'),
  timeRange: z
    .union([
      z.literal('all'),
      z.literal('*'),
      z.string().regex(TIME_RANGE_PATTERN, "timeRange must look like '30d', '2w', '12h'"),
    ])
    .optional()
    .describe('Time range (e.g. 30d/2w/12h or all/*)'),
  createdAfter: timeValueSchema.optional().describe('Created time lower bound (ISO/ms/sec)'),
  createdBefore: timeValueSchema.optional().describe('Created time upper bound (ISO/ms/sec)'),
  updatedAfter: timeValueSchema.optional().describe('Updated time lower bound (ISO/ms/sec)'),
  updatedBefore: timeValueSchema.optional().describe('Updated time upper bound (ISO/ms/sec)'),
  detail: z.boolean().optional().describe('Include details like parentId/ancestorIds/depth'),
} satisfies ZodRawShape;

export const searchRemOverviewSchema = z.object(inputShape).superRefine((value, ctx) => {
  if (value.pagesOnly && value.excludePages) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pagesOnly'],
      message: 'pagesOnly and excludePages cannot both be true',
    });
  }
});
export type SearchRemOverviewInput = z.infer<typeof searchRemOverviewSchema>;

type SearchMode = z.infer<typeof SEARCH_MODE>;

class HardTimeoutError extends Error {
  readonly code = 'TIMEOUT';
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`DB query timed out after ${timeoutMs}ms`);
    this.name = 'HardTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

type WorkerJob =
  | {
      readonly kind: 'search_rem_overview';
      readonly input: SearchRemOverviewInput;
    }
  | {
      readonly kind: 'unknown';
    };

type WorkerResult =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: { readonly message: string; readonly stack?: string } };

function asErrorMessage(e: unknown): string {
  return String((e as any)?.message || e || 'Unknown error');
}

async function executeSearchRemOverviewDirect(params: SearchRemOverviewInput) {
  const parsed = parseOrThrow(searchRemOverviewSchema, params, { label: 'search_rem_overview' });
  const { result, info } = await withResolvedDatabase(parsed.dbPath, async (db) =>
    executeSearchRemOverviewWithDb(db, parsed),
  );
  return { dbPath: info.dbPath, resolution: info.source, dirName: info.dirName, ...result };
}

async function executeSearchRemOverviewWithHardTimeout(params: SearchRemOverviewInput, timeoutMs: number) {
  const selfUrl = new URL(import.meta.url);
  const isSourceMode = selfUrl.protocol === 'file:' && selfUrl.pathname.endsWith('.ts');

  if (isSourceMode) {
    return await executeSearchRemOverviewDirect(params);
  }

  return await runWorkerJob({
    url: selfUrl,
    workerData: { kind: 'search_rem_overview', input: params } satisfies WorkerJob,
    timeoutMs,
    onTimeout: () => new HardTimeoutError(timeoutMs),
  });
}

if (!isMainThread) {
  const port = parentPort;
  if (!port) {
    throw new Error('Worker parentPort is unavailable');
  }
  const job = (workerData ?? { kind: 'unknown' }) as WorkerJob;
  if (job.kind === 'search_rem_overview') {
    void executeSearchRemOverviewDirect(job.input).then(
      (result) => {
        port.postMessage({ ok: true, result } satisfies WorkerResult);
      },
      (e) => {
        port.postMessage({
          ok: false,
          error: { message: asErrorMessage(e), stack: (e as any)?.stack },
        } satisfies WorkerResult);
      },
    );
  } else {
    port.postMessage({ ok: false, error: { message: 'Unknown worker job' } } satisfies WorkerResult);
  }
}

type SearchRow = {
  aliasId: string;
  id: string;
  kt: unknown;
  ke: unknown;
  parentId: string | null;
  depth: number | null;
  rank: number;
  freqCounter: number;
  freqTime: number;
  ancestorNotRefText: string | null;
  ancestorIds: string | null;
  exactScore?: number;
  orderExact?: number;
};

export async function executeSearchRemOverview(params: SearchRemOverviewInput) {
  const parsed = parseOrThrow(searchRemOverviewSchema, params, { label: 'search_rem_overview' });

  const timeoutMs = typeof parsed.timeoutMs === 'number' ? Math.floor(parsed.timeoutMs) : undefined;
  if (timeoutMs && timeoutMs > 0) {
    return (await executeSearchRemOverviewWithHardTimeout(parsed, timeoutMs)) as any;
  }

  return await executeSearchRemOverviewDirect(parsed);
}

export async function executeSearchRemOverviewWithDb(db: BetterSqliteInstance, params: SearchRemOverviewInput) {
  const parsed = parseOrThrow(searchRemOverviewSchema, params, { label: 'search_rem_overview' });
  const limit = parsed.limit ?? 10;
  const mode = parsed.mode ?? 'auto';
  const offset = parsed.offset ?? 0;
  const { filters, summary } = resolveTimeFilters(parsed);
  const detail = parsed.detail ?? false;
  const preferExact = parsed.preferExact ?? true;
  const exactFirstSingle = parsed.exactFirstSingle ?? false;
  const parentId = parsed.parentId;

  let effectiveQuery = parsed.query;
  if (parsed.useCurrentDate) {
    const offset = parsed.dateOffsetDays ?? 0;
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    let format = 'yyyy/MM/dd';
    try {
      format = (await getDateFormatting(db)) ?? 'yyyy/MM/dd';
    } catch {
      format = 'yyyy/MM/dd';
    }
    effectiveQuery = formatDateWithPattern(target, format);
  }

  const items = searchRems(db, {
    query: effectiveQuery,
    limit: limit + 1,
    offset,
    mode,
    filters,
    preferExact,
    pagesOnly: parsed.pagesOnly,
    excludePages: parsed.excludePages,
  });

  let filtered = items;
  if (exactFirstSingle && preferExact) {
    const exact = filtered.filter((it) => it.exactScore === 1);
    if (exact.length > 0) {
      filtered = [exact[0]];
    }
  }
  if (parsed.pagesOnly) {
    filtered = filtered.filter((item) => (item.depth ?? null) === 1 || item.parentId == null);
  } else if (parsed.excludePages) {
    filtered = filtered.filter((item) => (item.depth ?? null) !== 1 && item.parentId != null);
  }
  if (parentId) {
    filtered = filtered.filter((item) => {
      if (item.parentId === parentId) return true;
      return item.ancestor?.ids?.includes(parentId) ?? false;
    });
  }

  const effectiveLimit = exactFirstSingle ? (filtered.length === 1 ? 1 : (parsed.limit ?? 5)) : limit;

  const visible = filtered.slice(0, effectiveLimit);
  const hasMore = filtered.length > effectiveLimit;
  const snippetLength = parsed.snippetLength ?? 180;
  const simplifiedMatches = visible.map((item) => simplifyMatch(item, snippetLength, detail));
  const markdown = buildMatchesMarkdown(simplifiedMatches);

  return {
    count: visible.length,
    offset,
    limit: effectiveLimit,
    hasMore,
    nextOffset: hasMore ? offset + effectiveLimit : null,
    filtersApplied: summary,
    markdown,
    matches: simplifiedMatches,
    queryUsed: effectiveQuery,
    totalFetched: filtered.length,
  };
}

function searchRems(
  db: BetterSqliteInstance,
  options: {
    query: string;
    limit: number;
    offset: number;
    mode: SearchMode;
    filters: TimeFilters;
    preferExact: boolean;
    pagesOnly?: boolean;
    excludePages?: boolean;
  },
) {
  const normalized = options.query.trim();
  if (!normalized) {
    return [];
  }

  const lowerQuery = normalized.toLowerCase();
  const likePattern = `%${lowerQuery.replace(/\s+/g, '%')}%`;
  const likePatternCompact = `%${lowerQuery.replace(/\s+/g, '')}%`;
  const { clause, params: filterParams } = buildTimeFilterClause(options.filters);
  const pageConds: string[] = [];
  if (options.pagesOnly) {
    pageConds.push("CAST(json_extract(doc, '$.rd') AS INTEGER) = 1");
  } else if (options.excludePages) {
    pageConds.push("CAST(json_extract(doc, '$.rd') AS INTEGER) <> 1");
  }
  const extra = [clause, ...pageConds].filter(Boolean).join(' AND ');
  const whereSuffix = extra ? ` AND ${extra}` : '';
  const likeStmt = db.prepare(
    `SELECT
      aliasId,
      id,
      json_extract(doc, '$.kt') AS kt,
      json_extract(doc, '$.ke') AS ke,
      json_extract(doc, '$.p') AS parentId,
      json_extract(doc, '$.rd') AS depth,
      COALESCE((SELECT rank FROM remsSearchRanks WHERE ftsRowId = remsSearchInfos.ftsRowId), 0) AS rank,
      freqCounter,
      freqTime,
      ancestor_not_ref_text AS ancestorNotRefText,
      ancestor_ids AS ancestorIds,
	      -- Exact match marker: title/alias (r) equals query (case/space-insensitive)
      CASE WHEN (
        lower(json_extract(doc, '$.kt')) = @exact
        OR REPLACE(lower(json_extract(doc, '$.kt')), ' ', '') = @exactCompact
        OR lower(json_extract(doc, '$.ke')) = @exact
        OR REPLACE(lower(json_extract(doc, '$.ke')), ' ', '') = @exactCompact
        OR lower(json_extract(doc, '$.r')) = @exact
      ) THEN 1 ELSE 0 END AS exactScore,
	      -- Conditionally boost exact matches when preferExact is enabled
      CASE WHEN @preferExact != 0 THEN (
        CASE WHEN (
          lower(json_extract(doc, '$.kt')) = @exact
          OR REPLACE(lower(json_extract(doc, '$.kt')), ' ', '') = @exactCompact
          OR lower(json_extract(doc, '$.ke')) = @exact
          OR REPLACE(lower(json_extract(doc, '$.ke')), ' ', '') = @exactCompact
          OR lower(json_extract(doc, '$.r')) = @exact
        ) THEN 1 ELSE 0 END
      ) ELSE 0 END AS orderExact
    FROM remsSearchInfos
    WHERE (
       lower(json_extract(doc, '$.kt')) LIKE @pattern
       OR lower(json_extract(doc, '$.ke')) LIKE @pattern
       OR REPLACE(lower(json_extract(doc, '$.kt')), ' ', '') LIKE @patternCompact
       OR REPLACE(lower(json_extract(doc, '$.ke')), ' ', '') LIKE @patternCompact
       OR lower(json_extract(doc, '$.r')) LIKE @pattern
    )${whereSuffix}
    ORDER BY orderExact DESC, rank DESC, freqCounter DESC
    LIMIT @limit OFFSET @offset`,
  );

  const rows = likeStmt.all({
    pattern: likePattern,
    patternCompact: likePatternCompact,
    limit: options.limit,
    offset: options.offset,
    preferExact: options.preferExact ? 1 : 0,
    exact: lowerQuery,
    exactCompact: lowerQuery.replace(/\s+/g, ''),
    ...filterParams,
  }) as SearchRow[];
  let items = rows.map(mapRowToItem);

  if (options.mode === 'fts' || (options.mode === 'auto' && items.length === 0)) {
    try {
      const ftsStmt = db.prepare(
        `SELECT
          aliasId,
          id,
          json_extract(doc, '$.kt') AS kt,
          json_extract(doc, '$.ke') AS ke,
          json_extract(doc, '$.p') AS parentId,
          json_extract(doc, '$.rd') AS depth,
          COALESCE((SELECT rank FROM remsSearchRanks WHERE ftsRowId = remsSearchInfos.ftsRowId), 0) AS rank,
          freqCounter,
          freqTime,
          ancestor_not_ref_text AS ancestorNotRefText,
          ancestor_ids AS ancestorIds,
	          -- Exact match marker
          CASE WHEN (
            lower(json_extract(doc, '$.kt')) = @exact
            OR REPLACE(lower(json_extract(doc, '$.kt')), ' ', '') = @exactCompact
            OR lower(json_extract(doc, '$.ke')) = @exact
            OR REPLACE(lower(json_extract(doc, '$.ke')), ' ', '') = @exactCompact
            OR lower(json_extract(doc, '$.r')) = @exact
          ) THEN 1 ELSE 0 END AS exactScore,
          CASE WHEN @preferExact != 0 THEN (
            CASE WHEN (
              lower(json_extract(doc, '$.kt')) = @exact
              OR REPLACE(lower(json_extract(doc, '$.kt')), ' ', '') = @exactCompact
              OR lower(json_extract(doc, '$.ke')) = @exact
              OR REPLACE(lower(json_extract(doc, '$.ke')), ' ', '') = @exactCompact
              OR lower(json_extract(doc, '$.r')) = @exact
            ) THEN 1 ELSE 0 END
          ) ELSE 0 END AS orderExact
        FROM remsSearchInfos
        WHERE ftsRowId IN (
          SELECT rowid FROM remsContents WHERE remsContents MATCH @matchQuery
        )${whereSuffix}
        ORDER BY orderExact DESC, rank DESC, freqCounter DESC
        LIMIT @limit OFFSET @offset`,
      );

      const ftsRows = ftsStmt.all({
        matchQuery: normalized,
        limit: options.limit,
        offset: options.offset,
        exact: lowerQuery,
        exactCompact: lowerQuery.replace(/\s+/g, ''),
        preferExact: options.preferExact ? 1 : 0,
        ...filterParams,
      }) as SearchRow[];
      if (ftsRows.length > 0) {
        items = ftsRows.map(mapRowToItem);
      }
    } catch (error) {
      if (options.mode === 'fts') {
        throw new Error(
          `FTS query failed (custom tokenizer may be disabled or syntax is incompatible). Try mode="like", or omit mode to use auto. Original error: ${String(
            error,
          )}`,
        );
      }
      // otherwise ignore and fall back to LIKE results
    }
  }

  return items;
}

function mapRowToItem(row: SearchRow) {
  return {
    id: row.id,
    parentId: row.parentId,
    text: coalesceText(row.kt, row.ke),
    depth: row.depth,
    exactScore: row.exactScore ?? 0,
    ancestor: stringifyAncestor(row.ancestorNotRefText, row.ancestorIds),
  };
}

function simplifyMatch(item: ReturnType<typeof mapRowToItem>, snippetLength: number, detail: boolean) {
  const preview = createPreview(item.text, snippetLength);
  const base = {
    id: item.id,
    title: preview.title,
    snippet: preview.snippet,
    truncated: preview.truncated,
    ancestor: item.ancestor?.text ?? null,
    isPage: (item.depth ?? null) === 1 || item.parentId == null,
  };
  if (!detail) {
    return base;
  }
  return {
    ...base,
    parentId: item.parentId,
    ancestorIds: item.ancestor?.ids ?? [],
    rawText: item.text,
    depth: item.depth ?? null,
  };
}

function buildMatchesMarkdown(matches: ReturnType<typeof simplifyMatch>[]) {
  if (!matches || matches.length === 0) {
    return 'No matching Rem found.';
  }
  const lines: string[] = ['# Search Results'];
  matches.forEach((match, index) => {
    const title = match.title?.trim() ? match.title.trim() : '(Untitled)';
    const ancestor = match.ancestor ? `, in: ${match.ancestor}` : '';
    const snippet = match.snippet ? `\n  - ${match.snippet}` : '';
    lines.push(`- **${index + 1}. ${title}** (ID: ${match.id}${ancestor})${snippet}`);
  });
  return lines.join('\n');
}

function buildTimeFilterClause(filters: TimeFilters): {
  clause: string;
  params: Record<string, number>;
} {
  const conditions: string[] = [];
  const params: Record<string, number> = {};

  const createdExpr = `COALESCE(
    CAST(json_extract(doc, '$.c') AS INTEGER),
    (SELECT CAST(json_extract(q.doc, '$.createdAt') AS INTEGER) FROM quanta q WHERE q._id = remsSearchInfos.id)
  )`;
  const updatedExpr = `COALESCE(
    (SELECT CAST(json_extract(q.doc, '$.m') AS INTEGER) FROM quanta q WHERE q._id = remsSearchInfos.id),
    CAST(json_extract(doc, '$.c') AS INTEGER)
  )`;

  if (filters.createdAfter !== undefined) {
    conditions.push(`${createdExpr} >= @createdAfter`);
    params.createdAfter = filters.createdAfter;
  }
  if (filters.createdBefore !== undefined) {
    conditions.push(`${createdExpr} <= @createdBefore`);
    params.createdBefore = filters.createdBefore;
  }
  if (filters.updatedAfter !== undefined) {
    conditions.push(`${updatedExpr} >= @updatedAfter`);
    params.updatedAfter = filters.updatedAfter;
  }
  if (filters.updatedBefore !== undefined) {
    conditions.push(`${updatedExpr} <= @updatedBefore`);
    params.updatedBefore = filters.updatedBefore;
  }

  return {
    clause: conditions.join(' AND '),
    params,
  };
}

// NOTE: filter summary formatting is provided by timeFilters.describeFilterSummary
