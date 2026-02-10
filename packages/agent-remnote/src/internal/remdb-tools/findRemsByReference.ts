import { z, type ZodRawShape } from 'zod';

import { withResolvedDatabase, parseOrThrow, type BetterSqliteInstance } from './shared.js';
import {
  TIME_RANGE_PATTERN,
  timeValueSchema,
  resolveTimeFilters,
  describeFilterSummary,
  type TimeFilters,
} from './timeFilters.js';
import { createPreview, coalesceText } from './searchUtils.js';

const inputShape = {
  targetIds: z
    .array(z.string().min(1))
    .min(1, 'targetIds must contain at least 1 item')
    .describe('Target anchor Rem IDs (the referenced objects)'),
  maxDepth: z.number().int().min(1).max(3).optional().describe('Max reference depth (default 1; recommended <= 2)'),
  limit: z.number().int().min(1).max(200).optional().describe('Max results to return (pagination)'),
  offset: z.number().int().min(0).optional().describe('Pagination offset'),
  maxCandidates: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe('Candidate cap to limit search size (default 200)'),
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
  autoExpandDepth: z.boolean().optional().describe('Auto-increase depth when no matches (default true)'),
  maxAutoDepth: z.number().int().min(1).max(3).optional().describe('Max auto-expanded depth (default 3)'),
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
  detail: z.boolean().optional().describe('Include detailed fields (parentId/ancestorIds, etc.)'),
} satisfies ZodRawShape;

export const findRemsByReferenceSchema = z.object(inputShape);
export type FindRemsByReferenceInput = z.infer<typeof findRemsByReferenceSchema>;

interface ReferenceRow {
  id: string;
  parentId: string | null;
  ancestorText: string | null;
  ancestorIds: string | null;
  text: string;
  matchedTargetIds: string[];
  updatedAt: number | null;
  createdAt: number | null;
}

interface ReferenceMatch extends ReferenceRow {
  depth: number;
  anchors: Set<string>;
  sources: Set<string>;
}

type ReferenceMatchItem = {
  id: string;
  title: string | null;
  snippet: string | null;
  truncated: boolean;
  parentId: string | null;
  ancestor: string | null;
  ancestorIds: string[];
  matchedTargets: string[];
  anchorIds: string[];
  sourceIds: string[];
  depth: number;
  updatedAt: number | null;
  createdAt: number | null;
};

export async function executeFindRemsByReference(params: FindRemsByReferenceInput) {
  const parsed = parseOrThrow(findRemsByReferenceSchema, params, { label: 'find_rems_by_reference' });
  const limit = parsed.limit ?? 40;
  const offset = parsed.offset ?? 0;
  const requestedDepth = parsed.maxDepth ?? 1;
  const autoExpand = parsed.autoExpandDepth ?? true;
  const maxAutoDepth = parsed.maxAutoDepth ?? 3;
  const depthCeiling = Math.min(Math.max(requestedDepth, maxAutoDepth), 3);
  const maxCandidates = parsed.maxCandidates ?? 200;
  const detail = parsed.detail ?? false;

  const { filters, summary } = resolveTimeFilters(parsed);

  const { result, info } = await withResolvedDatabase(parsed.dbPath, async (db) => {
    let matches = new Map<string, ReferenceMatch>();
    const depthAttempts: number[] = [];
    let appliedDepth = requestedDepth;

    for (let depth = requestedDepth; depth <= depthCeiling; depth++) {
      depthAttempts.push(depth);
      matches = collectReferenceMatches(db, {
        targetIds: parsed.targetIds,
        filters,
        maxDepth: depth,
        maxCandidates,
      });
      appliedDepth = depth;
      if (matches.size > 0 || !autoExpand) {
        break;
      }
    }

    const all = Array.from(matches.values());
    all.sort((a, b) => {
      const diff = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    const sliced = all.slice(offset, offset + limit);
    const hasMore = offset + sliced.length < all.length;
    const nextOffset = hasMore ? offset + sliced.length : null;

    const snippetLength = 200;
    const items = sliced.map((match): ReferenceMatchItem => {
      const preview = createPreview(match.text, snippetLength);
      const anchors = Array.from(match.anchors);
      const sources = Array.from(match.sources);
      return {
        id: match.id,
        title: preview.title,
        snippet: preview.snippet,
        truncated: preview.truncated,
        parentId: match.parentId,
        ancestor: match.ancestorText,
        ancestorIds: match.ancestorIds?.split(/\s+/).filter(Boolean) ?? [],
        matchedTargets: match.matchedTargetIds,
        anchorIds: anchors,
        sourceIds: sources,
        depth: match.depth,
        updatedAt: match.updatedAt,
        createdAt: match.createdAt,
      };
    });

    return {
      items,
      total: all.length,
      hasMore,
      nextOffset,
      appliedDepth,
      depthAttempts,
    };
  });

  const guidance =
    result.total > 0
      ? `Found ${result.total} reference matches (${describeFilterSummary(summary) ?? 'no extra filters'}).`
      : `No reference matches found (${describeFilterSummary(summary) ?? 'no filters'}).`;

  const matches = detail ? result.items : result.items.map((item) => simplifyMatch(item));
  const referenceIndex = buildReferenceIndex(result.items);

  return {
    dbPath: info.dbPath,
    resolution: info.source,
    dirName: info.dirName,
    targetIds: params.targetIds,
    depthRequested: requestedDepth,
    depthApplied: result.appliedDepth,
    depthAttempts: result.depthAttempts,
    autoExpandDepth: autoExpand,
    depthLimit: depthCeiling,
    maxCandidates,
    limit,
    offset,
    hasMore: result.hasMore,
    nextOffset: result.nextOffset,
    totalCount: result.total,
    filtersApplied: summary,
    count: matches.length,
    matches,
    markdown: buildMatchesMarkdown(matches),
    referenceIndex,
    guidance,
  };
}

type SimplifiedMatch = {
  id: string;
  title: string | null;
  snippet: string | null;
  truncated: boolean;
  ancestor: string | null;
  matchedTargets: string[];
  anchorIds: string[];
  depth: number;
  parentId?: string | null;
  ancestorIds?: string[];
  sourceIds?: string[];
  updatedAt?: number | null;
  createdAt?: number | null;
};

type DetailedMatch = SimplifiedMatch & {
  parentId: string | null;
  ancestorIds: string[];
  sourceIds: string[];
  updatedAt: number | null;
  createdAt: number | null;
};

type ReferenceIndexEntry = {
  totalOccurrences: number;
  samples: ReferenceSample[];
};

type ReferenceSample = {
  viaRemId: string;
  viaRemTitle: string | null;
  snippet: string | null;
  depth: number;
};

function simplifyMatch(item: ReferenceMatchItem): SimplifiedMatch {
  return {
    id: item.id,
    title: item.title,
    snippet: item.snippet,
    truncated: item.truncated,
    ancestor: item.ancestor,
    matchedTargets: item.matchedTargets ?? [],
    anchorIds: item.anchorIds ?? [],
    depth: item.depth ?? 0,
  };
}

function buildMatchesMarkdown(matches: Array<SimplifiedMatch | DetailedMatch>) {
  if (!matches || matches.length === 0) {
    return 'No reference matches found.';
  }
  const lines: string[] = ['# Reference Matches'];
  matches.forEach((match, index) => {
    const title = match.title?.trim() ? match.title.trim() : '(Untitled)';
    const ancestor = match.ancestor ? `, in: ${match.ancestor}` : '';
    const targets = match.matchedTargets.length > 0 ? `, targets: ${match.matchedTargets.join(', ')}` : '';
    lines.push(`- **${index + 1}. ${title}** (ID: ${match.id}${ancestor}, depth ${match.depth}${targets})`);
    if (match.snippet) {
      lines.push(`  - ${match.snippet}`);
    }
  });
  return lines.join('\n');
}

function buildReferenceIndex(matches: ReferenceMatchItem[]) {
  const index = new Map<string, ReferenceIndexEntry>();
  if (!Array.isArray(matches)) {
    return {};
  }
  for (const match of matches) {
    const sample: ReferenceSample = {
      viaRemId: match.id,
      viaRemTitle: match.title,
      snippet: match.snippet,
      depth: match.depth ?? 0,
    };
    const register = (id: string) => {
      if (!id) return;
      const entry = index.get(id);
      if (entry) {
        entry.totalOccurrences += 1;
        if (entry.samples.length < 5) {
          entry.samples.push(sample);
        }
      } else {
        index.set(id, {
          totalOccurrences: 1,
          samples: [sample],
        });
      }
    };
    for (const target of match.matchedTargets ?? []) {
      register(target);
    }
    for (const anchor of match.anchorIds ?? []) {
      register(anchor);
    }
  }
  const result: Record<string, ReferenceIndexEntry> = {};
  for (const [id, entry] of index.entries()) {
    result[id] = entry;
  }
  return result;
}

function collectReferenceMatches(
  db: BetterSqliteInstance,
  options: { targetIds: string[]; filters: TimeFilters; maxDepth: number; maxCandidates: number },
): Map<string, ReferenceMatch> {
  const visited = new Set<string>(options.targetIds);
  const anchorMap = new Map<string, Set<string>>();
  for (const id of options.targetIds) {
    anchorMap.set(id, new Set([id]));
  }

  const results = new Map<string, ReferenceMatch>();

  let depth = 1;
  let frontier = new Set<string>(options.targetIds);

  while (frontier.size > 0 && depth <= options.maxDepth && results.size < options.maxCandidates) {
    const targets = Array.from(frontier);
    frontier = new Set();

    const rows = queryDirectReferences(db, targets, options.filters);

    for (const row of rows) {
      if (row.id === undefined) continue;

      const sources = row.matchedTargetIds;
      const anchorSets = sources.map((sourceId) => anchorMap.get(sourceId) ?? new Set([sourceId]));
      const anchors = mergeSets(anchorSets);

      const existing = results.get(row.id);
      if (existing) {
        existing.depth = Math.min(existing.depth, depth);
        existing.anchors = mergeSets([existing.anchors, anchors]);
        existing.sources = mergeSets([existing.sources, new Set(sources)]);
        existing.matchedTargetIds = Array.from(new Set([...existing.matchedTargetIds, ...row.matchedTargetIds]));
        existing.updatedAt = chooseLatest(existing.updatedAt, row.updatedAt);
        existing.createdAt = chooseLatest(existing.createdAt, row.createdAt);
      } else {
        results.set(row.id, {
          ...row,
          depth,
          anchors,
          sources: new Set(sources),
        });
      }

      if (!visited.has(row.id)) {
        visited.add(row.id);
        frontier.add(row.id);
        if (!anchorMap.has(row.id)) {
          anchorMap.set(row.id, anchors);
        } else {
          anchorMap.set(row.id, mergeSets([anchorMap.get(row.id) ?? new Set(), anchors]));
        }
      }

      if (results.size >= options.maxCandidates) {
        break;
      }
    }

    if (results.size >= options.maxCandidates) {
      break;
    }

    depth += 1;
  }

  return results;
}

function queryDirectReferences(db: BetterSqliteInstance, targetIds: string[], filters: TimeFilters): ReferenceRow[] {
  if (targetIds.length === 0) return [];
  const targetsJson = JSON.stringify(targetIds);
  const { clause, params } = buildQuantaTimeFilterClause(filters, 'q');
  const sql = `WITH targets AS (
      SELECT value AS targetId FROM json_each(@targetsJson)
    ),
    refs AS (
      SELECT
        q._id AS id,
        targets.targetId AS targetId,
        CAST(json_extract(q.doc, '$.lm') AS INTEGER) AS updatedAt,
        CAST(json_extract(q.doc, '$.ct') AS INTEGER) AS createdAt
      FROM quanta q
      JOIN targets
      WHERE q._id != targets.targetId
        AND json_valid(q.doc)
        AND (
          (
            json_extract(q.doc, '$.key') IS NOT NULL
            AND (
              (instr(json_extract(q.doc, '$.key'), '"i":"q"') > 0 OR instr(json_extract(q.doc, '$.key'), '"i":"p"') > 0)
              AND instr(json_extract(q.doc, '$.key'), '"_id":"' || targets.targetId || '"') > 0
            )
          )
          OR (
            json_type(json_extract(q.doc, '$.value')) IS NOT NULL
            AND (
              (instr(json_extract(q.doc, '$.value'), '"i":"q"') > 0 OR instr(json_extract(q.doc, '$.value'), '"i":"p"') > 0)
              AND instr(json_extract(q.doc, '$.value'), '"_id":"' || targets.targetId || '"') > 0
            )
          )
        )
        ${clause ? `AND ${clause}` : ''}
    )
    SELECT
      refs.id AS id,
      json_extract(rsi.doc, '$.p') AS parentId,
      rsi.ancestor_not_ref_text AS ancestorText,
      rsi.ancestor_ids AS ancestorIds,
      json_extract(rsi.doc, '$.kt') AS kt,
      json_extract(rsi.doc, '$.ke') AS ke,
      GROUP_CONCAT(DISTINCT refs.targetId) AS matchedTargetIds,
      MAX(refs.updatedAt) AS updatedAt,
      MAX(refs.createdAt) AS createdAt
    FROM refs
    JOIN remsSearchInfos rsi ON rsi.id = refs.id
    GROUP BY refs.id`;

  const rows = db.prepare(sql).all({ targetsJson, ...params }) as Array<{
    id: string;
    parentId: string | null;
    ancestorText: string | null;
    ancestorIds: string | null;
    kt: unknown;
    ke: unknown;
    matchedTargetIds: string | null;
    updatedAt: number | null;
    createdAt: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    ancestorText: row.ancestorText,
    ancestorIds: row.ancestorIds,
    text: coalesceText(row.kt, row.ke),
    matchedTargetIds: row.matchedTargetIds
      ? row.matchedTargetIds
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  }));
}

function buildQuantaTimeFilterClause(filters: TimeFilters, alias: string) {
  const conditions: string[] = [];
  const params: Record<string, number> = {};

  const createdExpr = `COALESCE(
    CAST(json_extract(${alias}.doc, '$.createdAt') AS INTEGER),
    CAST(json_extract(${alias}.doc, '$.c') AS INTEGER)
  )`;
  const updatedExpr = `COALESCE(
    CAST(json_extract(${alias}.doc, '$.m') AS INTEGER),
    CAST(json_extract(${alias}.doc, '$.createdAt') AS INTEGER)
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

function mergeSets(sets: Array<Set<string> | undefined>): Set<string> {
  const result = new Set<string>();
  for (const set of sets) {
    if (!set) continue;
    for (const value of set) {
      result.add(value);
    }
  }
  return result;
}

function chooseLatest(current: number | null, incoming: number | null) {
  if (incoming == null) return current ?? null;
  if (current == null) return incoming;
  return Math.max(current, incoming);
}
