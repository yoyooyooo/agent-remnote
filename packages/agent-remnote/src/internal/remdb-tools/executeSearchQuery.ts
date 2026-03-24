import { z } from 'zod';

import {
  type QueryNode,
  queryNodeSchema,
  type QueryLeaf,
  normalizeQueryNode,
  sortModeSchema,
  type SortMode,
} from './searchQueryTypes.js';
import {
  formatDateWithPattern,
  getDateFormatting,
  withResolvedDatabase,
  safeJsonParse,
  parseOrThrow,
  type BetterSqliteInstance,
} from './shared.js';
import { coalesceText, createPreview, stringifyAncestor } from './searchUtils.js';

const queryScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('ids'), ids: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('descendants'), ids: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('ancestors'), ids: z.array(z.string().min(1)).min(1) }),
  z.object({
    kind: z.literal('daily_range'),
    from_offset_days: z.number().int(),
    to_offset_days: z.number().int(),
  }),
]);

const queryShapeSchema = z.object({
  roots_only: z.boolean().optional(),
});

export const executeSearchQuerySchema = z.object({
  query: z
    .object({
      version: z.literal(2).default(2),
      root: queryNodeSchema.describe('Query AST root node (supports text/tag/rem/attribute/page and and/or/not)'),
      scope: queryScopeSchema.optional().describe('Optional runtime-ready scope restriction'),
      shape: queryShapeSchema.optional().describe('Optional selector shape modifiers'),
      limitHint: z.number().int().min(1).max(500).optional().describe('Hint for max results (used by execution)'),
      pageSizeHint: z.number().int().min(5).max(200).optional().describe('Hint for page size (used by execution)'),
      sort: sortModeSchema.optional().describe('Sort strategy: rank/updatedAt/createdAt/attribute'),
      description: z.string().optional().describe('Human-readable query description'),
    })
    .describe('Query object produced by build_search_query (or manually constructed)'),
  dbPath: z.string().optional().describe('Database file path (defaults to auto-discover latest remnote.db)'),
  limit: z.number().int().min(1).max(100).optional().describe('Max items to return (pagination)'),
  offset: z.number().int().min(0).optional().describe('Pagination offset'),
  maxLeafResults: z
    .number()
    .int()
    .min(50)
    .max(5000)
    .optional()
    .describe('Max candidates per leaf node (avoid huge sets)'),
  snippetLength: z.number().int().min(30).max(400).optional().describe('Snippet length (characters)'),
});

export type ExecuteSearchQueryInput = z.infer<typeof executeSearchQuerySchema>;

type LeafResult = {
  ids: Set<string>;
  scores: Map<string, number>;
};

type MatchResult = LeafResult;

type UniverseContext = {
  allIds: Set<string>;
  baseScores: Map<string, number>;
};

type RemMetadata = {
  id: string;
  aliasId: string;
  text: string;
  ancestorText: string | null;
  ancestorIds: string[];
  parentId: string | null;
  rank: number;
  freqCounter: number;
  freqTime: number;
  updatedAt: number | null;
  createdAt: number | null;
  sortValue?: string | number | null;
};

const TEXT_WEIGHT = 8;
const TAG_WEIGHT = 5;
const POWERUP_WEIGHT = 6;
const REM_WEIGHT = 12;
const ATTRIBUTE_WEIGHT = 7;

export async function executeSearchQuery(
  input: ExecuteSearchQueryInput,
): Promise<{ payload: Record<string, unknown>; suggestions: string[] }> {
  const parsed = parseOrThrow(executeSearchQuerySchema, input, { label: 'execute_search_query' });
  const query = {
    ...parsed.query,
    root: normalizeQueryNode(parsed.query.root),
  };
  const limit = parsed.limit ?? query.pageSizeHint ?? query.limitHint ?? 20;
  const offset = parsed.offset ?? 0;
  const snippetLength = parsed.snippetLength ?? 200;
  const maxLeaf = parsed.maxLeafResults ?? 800;

  const { result, info } = await withResolvedDatabase(parsed.dbPath, async (db) => {
    return executeQueryInternal({
      db,
      query,
      limit,
      offset,
      snippetLength,
      maxLeafResults: maxLeaf,
    });
  });

  const suggestions: string[] = [];
  if (result.items.length > 0) {
    suggestions.push('Read full content: outline_rem_subtree or inspect_rem_doc');
    if (result.hasMore && result.nextOffset != null) {
      suggestions.push(`More results available. Call execute_search_query again with offset=${result.nextOffset}`);
    }
    suggestions.push('To refine, modify build_search_query.root and run again');
  } else {
    suggestions.push('No matches. Try broader keywords or fewer attribute filters');
  }

  const guidance =
    result.items.length > 0
      ? `Matched ${result.totalMatched} items. Returning ${result.items.length} (offset=${offset}, limit=${limit}).`
      : 'No matching Rem found. Adjust the query and try again.';

  const payload: Record<string, unknown> = {
    guidance,
    queryUsed: query,
    dbPath: info.dbPath,
    resolution: info.source,
    dirName: info.dirName,
    limit,
    offset,
    hasMore: result.hasMore,
    nextOffset: result.nextOffset,
    totalCandidates: result.totalCandidates,
    totalMatched: result.totalMatched,
    items: result.items,
  };

  return { payload, suggestions };
}

type ExecutionResult = {
  items: Array<ReturnType<typeof formatResultItem>>;
  totalCandidates: number;
  totalMatched: number;
  hasMore: boolean;
  nextOffset: number | null;
};

type LeafEvaluation = {
  node: QueryLeaf;
  result: LeafResult;
};

async function executeQueryInternal(params: {
  db: BetterSqliteInstance;
  query: {
    version?: 2;
    root: QueryNode;
    scope?: z.infer<typeof queryScopeSchema>;
    shape?: z.infer<typeof queryShapeSchema>;
    sort?: SortMode;
  };
  limit: number;
  offset: number;
  snippetLength: number;
  maxLeafResults: number;
}): Promise<ExecutionResult> {
  const { db, query, limit, offset, snippetLength, maxLeafResults } = params;
  const leaves = collectLeaves(query.root);
  const leafEvaluations = leaves.map((leaf) => ({
    node: leaf,
    result: evaluateLeaf(db, leaf, maxLeafResults),
  }));

  const universe = buildUniverse(leafEvaluations);
  const rootResult = evaluateNode(query.root, leafEvaluations, universe);
  let matchedIds = Array.from(rootResult.ids);
  if (query.scope) {
    const scopeIds = await buildScopeIds(db, query.scope);
    matchedIds = matchedIds.filter((id) => scopeIds.has(id));
  }

  const sortMode = query.sort ?? { mode: 'rank' as const };
  const metadata = fetchMetadata(db, matchedIds);
  const scoreMap = new Map<string, number>(matchedIds.map((id) => [id, rootResult.scores.get(id) ?? 0]));

  if (query.sort?.mode === 'attribute') {
    const sortValues = fetchAttributeSortValues(db, matchedIds, query.sort.attributeId);
    for (const [id, value] of sortValues) {
      const meta = metadata.get(id);
      if (meta) {
        meta.sortValue = value ?? undefined;
      }
    }
  }

  if (query.shape?.roots_only) {
    const matchedIdSet = new Set(matchedIds);
    matchedIds = matchedIds.filter((id) => {
      const parentId = metadata.get(id)?.parentId;
      return !parentId || !matchedIdSet.has(parentId);
    });
  }

  const sortedIds = sortResults(matchedIds, sortMode, metadata, scoreMap);
  const totalMatched = sortedIds.length;
  const paginated = sortedIds.slice(offset, offset + limit);
  const hasMore = offset + limit < sortedIds.length;
  const nextOffset = hasMore ? offset + limit : null;

  const items = paginated.map((id) => {
    const meta = metadata.get(id);
    if (!meta) {
      return formatResultItem({
        id,
        aliasId: id,
        text: '',
        ancestorText: null,
        ancestorIds: [],
        parentId: null,
        rank: 0,
        freqCounter: 0,
        freqTime: 0,
        updatedAt: null,
        createdAt: null,
        snippetLength,
        score: scoreMap.get(id) ?? 0,
      });
    }
    return formatResultItem({
      ...meta,
      snippetLength,
      score: scoreMap.get(id) ?? 0,
    });
  });

  return {
    items,
    totalCandidates: universe.allIds.size,
    totalMatched,
    hasMore,
    nextOffset,
  };
}

function collectLeaves(node: QueryNode, acc: QueryLeaf[] = []): QueryLeaf[] {
  if (node.type === 'and' || node.type === 'or') {
    for (const child of node.nodes) {
      collectLeaves(child, acc);
    }
    return acc;
  }
  if (node.type === 'not') {
    collectLeaves(node.node, acc);
    return acc;
  }
  acc.push(node);
  return acc;
}

function evaluateLeaf(db: BetterSqliteInstance, node: QueryLeaf, maxLeafResults: number): LeafResult {
  switch (node.type) {
    case 'text':
      return searchText(db, node.value, node.mode ?? 'contains', maxLeafResults);
    case 'tag':
      return searchTag(db, node.id, maxLeafResults);
    case 'powerup':
      return searchPowerup(db, node.powerup.by, node.powerup.value, maxLeafResults);
    case 'rem':
      return searchSpecificRem(node.id);
    case 'page':
      return searchPages(db, maxLeafResults);
    case 'attribute':
      return searchAttribute(db, node, maxLeafResults);
    default:
      return { ids: new Set(), scores: new Map() };
  }
}

function buildUniverse(evaluations: LeafEvaluation[]): UniverseContext {
  const allIds = new Set<string>();
  const baseScores = new Map<string, number>();
  for (const { result } of evaluations) {
    for (const id of result.ids) {
      allIds.add(id);
      baseScores.set(id, (baseScores.get(id) ?? 0) + (result.scores.get(id) ?? 0));
    }
  }
  return { allIds, baseScores };
}

function evaluateNode(node: QueryNode, evaluations: LeafEvaluation[], universe: UniverseContext): MatchResult {
  if (node.type === 'and') {
    const children = node.nodes.map((child) => evaluateNode(child, evaluations, universe));
    if (children.length === 0) {
      return { ids: new Set(), scores: new Map() };
    }
    let ids = new Set(children[0].ids);
    for (let i = 1; i < children.length; i++) {
      ids = intersectSets(ids, children[i].ids);
      if (ids.size === 0) break;
    }
    const scores = new Map<string, number>();
    for (const id of ids) {
      let score = 0;
      for (const child of children) {
        score += child.scores.get(id) ?? 0;
      }
      scores.set(id, score);
    }
    return { ids, scores };
  }

  if (node.type === 'or') {
    const children = node.nodes.map((child) => evaluateNode(child, evaluations, universe));
    const ids = new Set<string>();
    const scores = new Map<string, number>();
    for (const child of children) {
      for (const id of child.ids) {
        ids.add(id);
        const existing = scores.get(id) ?? 0;
        const candidate = child.scores.get(id) ?? 0;
        scores.set(id, Math.max(existing, candidate));
      }
    }
    return { ids, scores };
  }

  if (node.type === 'not') {
    const child = evaluateNode(node.node, evaluations, universe);
    const ids = new Set<string>();
    const scores = new Map<string, number>();
    for (const id of universe.allIds) {
      if (!child.ids.has(id)) {
        ids.add(id);
        scores.set(id, universe.baseScores.get(id) ?? 1);
      }
    }
    return { ids, scores };
  }

  // leaf node
  const evaluation = evaluations.find((entry) => entry.node === node);
  if (!evaluation) {
    return { ids: new Set(), scores: new Map() };
  }
  return evaluation.result;
}

function intersectSets(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const id of a) {
    if (b.has(id)) result.add(id);
  }
  return result;
}

function searchText(
  db: BetterSqliteInstance,
  value: string,
  mode: 'contains' | 'phrase' | 'prefix' | 'suffix',
  max: number,
): LeafResult {
  const normalized = value.trim();
  if (!normalized) {
    return { ids: new Set(), scores: new Map() };
  }
  const ids = new Set<string>();
  const scores = new Map<string, number>();

  const tryFts = (query: string) => {
    try {
      const stmt = db.prepare(
        `SELECT aliasId, id, COALESCE((SELECT rank FROM remsSearchRanks WHERE ftsRowId = remsSearchInfos.ftsRowId), 0) AS rank
         FROM remsSearchInfos
         WHERE ftsRowId IN (SELECT rowid FROM remsContents WHERE remsContents MATCH @query)
         LIMIT @limit`,
      );
      const rows = stmt.all({ query, limit: max }) as Array<{ aliasId: string; id: string; rank: number }>;
      for (const row of rows) {
        ids.add(row.id);
        scores.set(row.id, (scores.get(row.id) ?? 0) + TEXT_WEIGHT + row.rank);
      }
    } catch (error) {
      const message = String(error ?? '');
      if (!/malformed MATCH/i.test(message) && !/no such tokenizer/i.test(message)) {
        throw error;
      }
    }
  };

  switch (mode) {
    case 'phrase':
      tryFts(`"${normalized.replace(/"/g, '""')}"`);
      if (ids.size === 0) {
        runLikeSearch(db, `%${normalized.toLowerCase().replace(/\s+/g, '%')}%`, max, ids, scores);
      }
      break;
    case 'prefix':
      tryFts(`${normalized.replace(/"/g, ' ')}*`);
      if (ids.size === 0) {
        runLikeSearch(db, `${normalized.toLowerCase().replace(/\s+/g, '%')}%`, max, ids, scores);
      }
      break;
    case 'suffix':
      runLikeSearch(db, `%${normalized.toLowerCase()}`, max, ids, scores);
      break;
    case 'contains':
    default:
      tryFts(normalized);
      if (ids.size === 0) {
        runLikeSearch(db, `%${normalized.toLowerCase().replace(/\s+/g, '%')}%`, max, ids, scores);
      }
      break;
  }

  return { ids, scores };
}

function searchPages(db: BetterSqliteInstance, max: number): LeafResult {
  const ids = new Set<string>();
  const scores = new Map<string, number>();
  const stmt = db.prepare(
    `SELECT id, COALESCE((SELECT rank FROM remsSearchRanks WHERE ftsRowId = remsSearchInfos.ftsRowId), 0) AS rank
     FROM remsSearchInfos
     WHERE CAST(json_extract(doc,'$.rd') AS INTEGER) = 1
     LIMIT @limit`,
  );
  const rows = stmt.all({ limit: max }) as Array<{ id: string; rank: number }>;
  for (const row of rows) {
    ids.add(row.id);
    scores.set(row.id, (scores.get(row.id) ?? 0) + REM_WEIGHT + row.rank);
  }
  return { ids, scores };
}

function runLikeSearch(
  db: BetterSqliteInstance,
  pattern: string,
  max: number,
  ids: Set<string>,
  scores: Map<string, number>,
) {
  const compactSource = pattern.replace(/%/g, '').replace(/\s+/g, '');
  const patternCompact = compactSource ? `%${compactSource}%` : pattern;
  const stmt = db.prepare(
    `SELECT aliasId, id, 0 AS rank
     FROM remsSearchInfos
     WHERE lower(json_extract(doc, '$.kt')) LIKE @pattern
        OR lower(json_extract(doc, '$.ke')) LIKE @pattern
        OR REPLACE(lower(json_extract(doc, '$.kt')), ' ', '') LIKE @patternCompact
        OR REPLACE(lower(json_extract(doc, '$.ke')), ' ', '') LIKE @patternCompact
     LIMIT @limit`,
  );
  const rows = stmt.all({ pattern, patternCompact, limit: max }) as Array<{
    aliasId: string;
    id: string;
    rank: number;
  }>;
  for (const row of rows) {
    ids.add(row.id);
    scores.set(row.id, (scores.get(row.id) ?? 0) + TEXT_WEIGHT);
  }
}

function searchTag(db: BetterSqliteInstance, tagId: string, max: number): LeafResult {
  const stmt = db.prepare(
    `SELECT _id
     FROM quanta
     WHERE json_extract(doc, '$.tp."${tagId}".t') = 1
     LIMIT @limit`,
  );
  const rows = stmt.all({ limit: max }) as Array<{ _id: string }>;
  const ids = new Set<string>();
  const scores = new Map<string, number>();
  for (const row of rows) {
    ids.add(row._id);
    scores.set(row._id, (scores.get(row._id) ?? 0) + TAG_WEIGHT);
  }
  return { ids, scores };
}

function searchPowerup(
  db: BetterSqliteInstance,
  by: 'id' | 'rcrt',
  value: string,
  max: number,
): LeafResult {
  const matchingPowerupIds =
    by === 'id'
      ? new Set<string>([value])
      : new Set<string>(
          (
            db.prepare(
              `SELECT _id
                 FROM quanta
                WHERE json_extract(doc, '$.rcrt') = @value`,
            ).all({ value }) as Array<{ _id: string }>
          ).map((row) => row._id),
        );
  if (matchingPowerupIds.size === 0) {
    return { ids: new Set(), scores: new Map() };
  }

  const rows = db
    .prepare(
      `SELECT _id, doc
         FROM quanta
        WHERE doc LIKE '%"tp"%'`,
    )
    .all() as Array<{ _id: string; doc: string }>;
  const ids = new Set<string>();
  const scores = new Map<string, number>();

  for (const row of rows) {
    const doc = safeJsonParse<Record<string, unknown>>(row.doc);
    const tp = isRecord(doc?.tp) ? (doc.tp as Record<string, unknown>) : null;
    if (!tp) continue;
    const matched = Object.keys(tp).some((powerupId) => matchingPowerupIds.has(powerupId));
    if (!matched) continue;
    ids.add(row._id);
    scores.set(row._id, (scores.get(row._id) ?? 0) + POWERUP_WEIGHT);
  }

  return { ids, scores };
}

async function buildScopeIds(
  db: BetterSqliteInstance,
  scope: z.infer<typeof queryScopeSchema>,
): Promise<Set<string>> {
  switch (scope.kind) {
    case 'all':
      return fetchAllIds(db);
    case 'ids':
      return new Set(scope.ids);
    case 'descendants':
      return expandDescendants(fetchParentMap(db), scope.ids);
    case 'ancestors':
      return expandAncestors(fetchParentMap(db), scope.ids);
    case 'daily_range':
      return await expandDailyRangeScope(db, scope.from_offset_days, scope.to_offset_days);
  }
}

function fetchAllIds(db: BetterSqliteInstance): Set<string> {
  const rows = db.prepare('SELECT _id FROM quanta').all() as Array<{ _id: string }>;
  return new Set(rows.map((row) => row._id));
}

function fetchParentMap(db: BetterSqliteInstance): Map<string, string | null> {
  const rows = db
    .prepare(`SELECT _id, json_extract(doc, '$.parent') AS parentId FROM quanta`)
    .all() as Array<{ _id: string; parentId: string | null }>;
  return new Map(rows.map((row) => [row._id, row.parentId ?? null] as const));
}

function expandDescendants(parentMap: Map<string, string | null>, roots: readonly string[]): Set<string> {
  const targets = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, parentId] of parentMap.entries()) {
      if (!parentId || !targets.has(parentId) || targets.has(id)) continue;
      targets.add(id);
      changed = true;
    }
  }
  return targets;
}

function expandAncestors(parentMap: Map<string, string | null>, roots: readonly string[]): Set<string> {
  const targets = new Set(roots);
  for (const root of roots) {
    let current = parentMap.get(root) ?? null;
    while (current) {
      if (targets.has(current)) break;
      targets.add(current);
      current = parentMap.get(current) ?? null;
    }
  }
  return targets;
}

async function expandDailyRangeScope(
  db: BetterSqliteInstance,
  fromOffsetDays: number,
  toOffsetDays: number,
): Promise<Set<string>> {
  const format = (await getDateFormatting(db)) ?? 'yyyy/MM/dd';
  const titles = new Set<string>();
  const min = Math.min(fromOffsetDays, toOffsetDays);
  const max = Math.max(fromOffsetDays, toOffsetDays);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let offset = min; offset <= max; offset++) {
    const target = new Date(today);
    target.setDate(target.getDate() + offset);
    titles.add(formatDateWithPattern(target, format));
    titles.add(formatDateWithPattern(target, 'yyyy/MM/dd'));
  }

  const rows = db.prepare(`SELECT _id, doc FROM quanta`).all() as Array<{ _id: string; doc: string }>;
  const dailyIds = rows
    .filter((row) => {
      const doc = safeJsonParse<Record<string, unknown>>(row.doc);
      const title = summarizeTitle(doc);
      return title ? titles.has(title) : false;
    })
    .map((row) => row._id);
  if (dailyIds.length === 0) return new Set();
  return expandDescendants(fetchParentMap(db), dailyIds);
}

function summarizeTitle(doc: Record<string, unknown> | null | undefined): string {
  const key = doc?.key;
  if (!Array.isArray(key) || key.length === 0) return '';
  const first = key[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof (first as any).text === 'string') return (first as any).text;
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function searchSpecificRem(remId: string): LeafResult {
  const ids = new Set<string>([remId]);
  const scores = new Map<string, number>([[remId, REM_WEIGHT]]);
  return { ids, scores };
}

function searchAttribute(
  db: BetterSqliteInstance,
  condition: Extract<QueryLeaf, { type: 'attribute' }>,
  max: number,
): LeafResult {
  const stmt = db.prepare(
    `SELECT json_extract(doc, '$.parent') AS parentId, doc
     FROM quanta
     WHERE json_extract(doc, '$.key[0]._id') = @attributeId
     LIMIT @limit`,
  );
  const rows = stmt.all({ attributeId: condition.attributeId, limit: max }) as Array<{
    parentId: string | null;
    doc: string;
  }>;
  const ids = new Set<string>();
  const scores = new Map<string, number>();
  const dateCache = new Map<string, number | null>();

  for (const row of rows) {
    if (!row.parentId) continue;
    const parsed = safeJsonParse<Record<string, unknown>>(row.doc);
    if (!parsed) continue;
    const match = evaluateAttributeCondition(db, parsed, condition, dateCache);
    if (!match) continue;
    ids.add(row.parentId);
    scores.set(row.parentId, (scores.get(row.parentId) ?? 0) + ATTRIBUTE_WEIGHT);
  }

  return { ids, scores };
}

function evaluateAttributeCondition(
  db: BetterSqliteInstance,
  doc: Record<string, unknown>,
  condition: Extract<QueryLeaf, { type: 'attribute' }>,
  dateCache: Map<string, number | null>,
): boolean {
  const value = doc.value;

  const tokens = Array.isArray(value) ? value : value != null ? [value] : [];
  const strings: string[] = [];
  const refs: string[] = [];

  for (const token of tokens) {
    if (typeof token === 'string') {
      strings.push(token);
      continue;
    }
    if (token && typeof token === 'object') {
      const obj = token as Record<string, unknown>;
      if (obj.i === 'q' && typeof obj._id === 'string') {
        refs.push(obj._id);
        continue;
      }
      if (typeof obj.text === 'string') {
        strings.push(obj.text);
        continue;
      }
      if (typeof obj.title === 'string') {
        strings.push(obj.title);
        continue;
      }
    }
  }

  const isEmpty = tokens.length === 0;

  switch (condition.operator) {
    case 'equals':
      if (condition.value === undefined) return false;
      const equalsValue = normalizeConditionValue(condition.value);
      return strings.includes(equalsValue) || refs.includes(String(condition.value));
    case 'notEquals':
      if (condition.value === undefined) return false;
      const notEqualsValue = normalizeConditionValue(condition.value);
      return !strings.includes(notEqualsValue) && !refs.includes(String(condition.value));
    case 'contains':
      if (!condition.value && !condition.values) return false;
      if (condition.values) {
        return condition.values.every((val) => strings.includes(String(val)) || refs.includes(String(val)));
      }
      if (condition.value === undefined) return false;
      const containsValue = normalizeConditionValue(condition.value).toLowerCase();
      return strings.some((str) => str.toLowerCase().includes(containsValue));
    case 'notContains':
      if (!condition.value && !condition.values) return true;
      if (condition.values) {
        return condition.values.every((val) => !strings.includes(String(val)) && !refs.includes(String(val)));
      }
      if (condition.value === undefined) return true;
      const notContainsValue = normalizeConditionValue(condition.value).toLowerCase();
      return !strings.some((str) => str.toLowerCase().includes(notContainsValue));
    case 'greaterThan':
    case 'greaterThanOrEquals':
    case 'lessThan':
    case 'lessThanOrEquals':
    case 'between':
    case 'before':
    case 'after':
    case 'on':
    case 'relative': {
      const numeric = strings.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
      if (numeric.length > 0) {
        return evaluateNumericCondition(numeric, condition);
      }
      const dateValues: number[] = [];
      for (const ref of refs) {
        const ts = resolveDateReference(db, ref, dateCache);
        if (ts != null) dateValues.push(ts);
      }
      if (dateValues.length > 0) {
        return evaluateDateCondition(dateValues, condition);
      }
      return false;
    }
    case 'empty':
      return isEmpty;
    case 'notEmpty':
      return !isEmpty;
    default:
      return false;
  }
}

function evaluateNumericCondition(
  numericValues: number[],
  condition: Extract<QueryLeaf, { type: 'attribute' }>,
): boolean {
  const target = condition.value != null && typeof condition.value !== 'boolean' ? Number(condition.value) : undefined;
  const range = condition.range;

  switch (condition.operator) {
    case 'greaterThan':
      if (target == null) return false;
      return numericValues.some((value) => value > target);
    case 'greaterThanOrEquals':
      if (target == null) return false;
      return numericValues.some((value) => value >= target);
    case 'lessThan':
      if (target == null) return false;
      return numericValues.some((value) => value < target);
    case 'lessThanOrEquals':
      if (target == null) return false;
      return numericValues.some((value) => value <= target);
    case 'between':
      if (!range) return false;
      const start = range.start != null ? Number(range.start) : -Infinity;
      const end = range.end != null ? Number(range.end) : Infinity;
      return numericValues.some((value) => value >= start && value <= end);
    case 'after':
      if (target == null) return false;
      return numericValues.some((value) => value > target);
    case 'before':
      if (target == null) return false;
      return numericValues.some((value) => value < target);
    case 'on':
      if (target == null) return false;
      return numericValues.some((value) => value === target);
    case 'relative':
      if (condition.relativeAmount == null) return false;
      const base = Date.now();
      const unit = condition.unit ?? 'day';
      const delta = computeRelativeOffsetMs(condition.relativeAmount, unit);
      const boundary = base + delta;
      if (condition.relativeAmount >= 0) {
        return numericValues.some((value) => value <= boundary);
      }
      return numericValues.some((value) => value >= boundary);
    default:
      return false;
  }
}

function evaluateDateCondition(dateValues: number[], condition: Extract<QueryLeaf, { type: 'attribute' }>): boolean {
  const target =
    condition.value != null && (typeof condition.value === 'string' || typeof condition.value === 'number')
      ? normalizeDateInput(condition.value)
      : undefined;
  const range = condition.range;
  const now = Date.now();

  switch (condition.operator) {
    case 'before':
      if (target == null) return false;
      return dateValues.some((value) => value < target);
    case 'after':
      if (target == null) return false;
      return dateValues.some((value) => value > target);
    case 'on':
      if (target == null) return false;
      return dateValues.some((value) => isSameDay(value, target));
    case 'between':
      if (!range) return false;
      const start = range.start != null ? (normalizeDateInput(range.start) ?? -Infinity) : -Infinity;
      const end = range.end != null ? (normalizeDateInput(range.end) ?? Infinity) : Infinity;
      return dateValues.some((value) => value >= start && value <= end);
    case 'relative':
      if (condition.relativeAmount == null) return false;
      const unit = condition.unit ?? 'day';
      const delta = computeRelativeOffsetMs(condition.relativeAmount, unit);
      const boundary = now + delta;
      if (condition.relativeAmount >= 0) {
        return dateValues.some((value) => value <= boundary);
      }
      return dateValues.some((value) => value >= boundary);
    default:
      // Delegate other operators to numeric logic.
      return evaluateNumericCondition(dateValues, condition);
  }
}

function computeRelativeOffsetMs(amount: number, unit: string): number {
  switch (unit) {
    case 'minute':
    case 'minutes':
    case 'm':
      return amount * 60 * 1000;
    case 'hour':
    case 'hours':
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'day':
    case 'days':
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    case 'week':
    case 'weeks':
    case 'w':
      return amount * 7 * 24 * 60 * 60 * 1000;
    case 'month':
    case 'months':
    case 'M':
      return amount * 30 * 24 * 60 * 60 * 1000;
    case 'year':
    case 'years':
    case 'y':
      return amount * 365 * 24 * 60 * 60 * 1000;
    default:
      return amount * 24 * 60 * 60 * 1000;
  }
}

function normalizeDateInput(value: string | number): number | null {
  if (typeof value === 'number') {
    return value > 10_000 ? value : value * 1000;
  }
  const trimmed = value.trim();
  if (/^\d{10}$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  if (/^\d{13}$/.test(trimmed)) {
    return Number(trimmed);
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveDateReference(
  db: BetterSqliteInstance,
  remId: string,
  cache: Map<string, number | null>,
): number | null {
  if (cache.has(remId)) {
    return cache.get(remId) ?? null;
  }
  const row = db.prepare('SELECT doc FROM quanta WHERE _id = ?').get(remId) as { doc?: string } | undefined;
  if (!row?.doc) {
    cache.set(remId, null);
    return null;
  }
  const data = safeJsonParse<Record<string, unknown>>(row.doc);
  let result: number | null = null;
  const crt = data?.crt as Record<string, unknown> | undefined;
  const d = crt?.d as Record<string, unknown> | undefined;
  const seconds = (() => {
    const s = (d?.s as Record<string, unknown> | undefined)?.v;
    if (Array.isArray(s)) {
      const candidate = s[0];
      if (typeof candidate === 'string' && candidate.trim()) {
        const num = Number(candidate);
        if (Number.isFinite(num)) return num;
      }
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate;
      }
    }
    return undefined;
  })();
  if (seconds && Number.isFinite(seconds)) {
    result = seconds * 1000;
  }
  if (!result) {
    const dArray = (d?.d as Record<string, unknown> | undefined)?.v;
    if (Array.isArray(dArray) && dArray[0] != null) {
      const iso = String(dArray[0]);
      const parsed = Date.parse(iso);
      if (Number.isFinite(parsed)) {
        result = parsed;
      }
    }
  }
  if (!result && Array.isArray(data?.key)) {
    const keyCandidate = data.key[0];
    if (typeof keyCandidate === 'string') {
      const fromKey = Date.parse(keyCandidate);
      if (Number.isFinite(fromKey)) {
        result = fromKey;
      }
    }
  }
  cache.set(remId, result);
  return result;
}

function isSameDay(a: number, b: number): boolean {
  const dayA = new Date(a);
  const dayB = new Date(b);
  return (
    dayA.getFullYear() === dayB.getFullYear() &&
    dayA.getMonth() === dayB.getMonth() &&
    dayA.getDate() === dayB.getDate()
  );
}

function fetchMetadata(db: BetterSqliteInstance, ids: string[]): Map<string, RemMetadata> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const stmt = db.prepare(
    `SELECT aliasId, id, doc, ancestor_not_ref_text AS ancestorNotRefText, ancestor_ids AS ancestorIds,
            freqCounter, freqTime
     FROM remsSearchInfos
     WHERE id IN (${placeholders})`,
  );
  const rows = stmt.all(...ids) as Array<{
    aliasId: string;
    id: string;
    doc: string;
    ancestorNotRefText: string | null;
    ancestorIds: string | null;
    freqCounter: number;
    freqTime: number;
  }>;

  const quantaStmt = db.prepare(
    `SELECT _id, doc
     FROM quanta
     WHERE _id IN (${placeholders})`,
  );
  const quantaRows = quantaStmt.all(...ids) as Array<{ _id: string; doc: string }>;
  const quantaMap = new Map<string, Record<string, unknown>>();
  for (const row of quantaRows) {
    const doc = safeJsonParse<Record<string, unknown>>(row.doc);
    if (doc) quantaMap.set(row._id, doc);
  }

  const result = new Map<string, RemMetadata>();
  for (const row of rows) {
    const doc = safeJsonParse<Record<string, unknown>>(row.doc) ?? {};
    const text = coalesceText(doc.kt, doc.ke);
    const ancestor = stringifyAncestor(row.ancestorNotRefText, row.ancestorIds);
    const remDoc = quantaMap.get(row.id);
    const updatedAt = typeof remDoc?.u === 'number' ? remDoc.u : null;
    const createdAt = typeof remDoc?.createdAt === 'number' ? remDoc.createdAt : null;
    const parentId = typeof remDoc?.parent === 'string' ? (remDoc.parent as string) : null;
    result.set(row.id, {
      id: row.id,
      aliasId: row.aliasId,
      text,
      ancestorText: ancestor.text || null,
      ancestorIds: ancestor.ids,
      parentId,
      rank: typeof (doc.x as number) === 'number' ? (doc.x as number) : 0,
      freqCounter: row.freqCounter,
      freqTime: row.freqTime,
      updatedAt,
      createdAt,
      sortValue: undefined,
    });
  }
  return result;
}

function sortResults(
  ids: string[],
  sortMode: SortMode,
  metadata: Map<string, RemMetadata>,
  scoreMap: Map<string, number>,
): string[] {
  const candidates = ids.map((id) => ({ id, meta: metadata.get(id) }));
  switch (sortMode.mode) {
    case 'updatedAt':
      return candidates
        .sort((a, b) => {
          const av = a.meta?.updatedAt ?? 0;
          const bv = b.meta?.updatedAt ?? 0;
          const dir = sortMode.direction === 'asc' ? 1 : -1;
          if (av !== bv) return dir * (av - bv);
          const ascore = scoreMap.get(a.id) ?? 0;
          const bscore = scoreMap.get(b.id) ?? 0;
          return bscore - ascore;
        })
        .map((entry) => entry.id);
    case 'createdAt':
      return candidates
        .sort((a, b) => {
          const av = a.meta?.createdAt ?? 0;
          const bv = b.meta?.createdAt ?? 0;
          const dir = sortMode.direction === 'asc' ? 1 : -1;
          if (av !== bv) return dir * (av - bv);
          const ascore = scoreMap.get(a.id) ?? 0;
          const bscore = scoreMap.get(b.id) ?? 0;
          return bscore - ascore;
        })
        .map((entry) => entry.id);
    case 'attribute':
      return candidates
        .sort((a, b) => {
          const av = a.meta?.sortValue;
          const bv = b.meta?.sortValue;
          const dir = sortMode.direction === 'asc' ? 1 : -1;
          if (typeof av === 'number' && typeof bv === 'number') {
            if (av !== bv) return dir * (av - bv);
          } else if (typeof av === 'string' && typeof bv === 'string') {
            const cmp = av.localeCompare(bv);
            if (cmp !== 0) return dir * cmp;
          } else if (av != null && bv == null) {
            return -1;
          } else if (av == null && bv != null) {
            return 1;
          }
          const ascore = scoreMap.get(a.id) ?? 0;
          const bscore = scoreMap.get(b.id) ?? 0;
          return bscore - ascore;
        })
        .map((entry) => entry.id);
    case 'rank':
    default:
      return candidates
        .sort((a, b) => {
          const ascore = scoreMap.get(a.id) ?? 0;
          const bscore = scoreMap.get(b.id) ?? 0;
          if (ascore !== bscore) return bscore - ascore;
          const au = a.meta?.updatedAt ?? 0;
          const bu = b.meta?.updatedAt ?? 0;
          return bu - au;
        })
        .map((entry) => entry.id);
  }
}

function formatResultItem(params: {
  id: string;
  aliasId: string;
  text: string;
  ancestorText: string | null;
  ancestorIds: string[];
  parentId: string | null;
  rank: number;
  freqCounter: number;
  freqTime: number;
  updatedAt: number | null;
  createdAt: number | null;
  snippetLength: number;
  score: number;
}) {
  const { title, snippet, truncated } = createPreview(params.text, params.snippetLength);
  return {
    id: params.id,
    aliasId: params.aliasId,
    title,
    snippet,
    truncated,
    ancestor: params.ancestorText,
    ancestorIds: params.ancestorIds,
    parentId: params.parentId,
    rank: params.rank,
    freqCounter: params.freqCounter,
    freqTime: params.freqTime,
    updatedAt: params.updatedAt,
    createdAt: params.createdAt,
    score: Number(params.score.toFixed(2)),
  };
}

function fetchAttributeSortValues(
  db: BetterSqliteInstance,
  ids: string[],
  attributeId: string,
): Map<string, number | string | null> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const stmt = db.prepare(
    `SELECT json_extract(doc, '$.parent') AS parentId, doc
     FROM quanta
     WHERE json_extract(doc, '$.key[0]._id') = ?
       AND json_extract(doc, '$.parent') IN (${placeholders})`,
  );
  const rows = stmt.all(attributeId, ...ids) as Array<{ parentId: string | null; doc: string }>;
  const cache = new Map<string, number | null>();
  const result = new Map<string, number | string | null>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const parsed = safeJsonParse<Record<string, unknown>>(row.doc);
    if (!parsed) continue;
    const value = extractSortValue(parsed, db, cache);
    if (value != null) {
      result.set(row.parentId, value);
    }
  }
  return result;
}

function extractSortValue(
  doc: Record<string, unknown>,
  db: BetterSqliteInstance,
  cache: Map<string, number | null>,
): number | string | null {
  const rawValue = doc.value;
  const tokens = Array.isArray(rawValue) ? rawValue : rawValue != null ? [rawValue] : [];
  const numbers: number[] = [];
  const refs: string[] = [];
  const strings: string[] = [];

  for (const token of tokens) {
    if (typeof token === 'string') {
      strings.push(token);
      const num = Number(token);
      if (Number.isFinite(num)) numbers.push(num);
      continue;
    }
    if (token && typeof token === 'object') {
      const obj = token as Record<string, unknown>;
      if (obj.i === 'q' && typeof obj._id === 'string') {
        refs.push(obj._id);
        continue;
      }
      if (typeof obj.text === 'string') {
        strings.push(obj.text);
        const num = Number(obj.text);
        if (Number.isFinite(num)) numbers.push(num);
        continue;
      }
    }
  }

  if (numbers.length > 0) {
    return numbers[0];
  }
  for (const ref of refs) {
    const ts = resolveDateReference(db, ref, cache);
    if (ts != null) {
      return ts;
    }
  }
  if (strings.length > 0) {
    return strings[0].toLowerCase();
  }
  return null;
}

function normalizeConditionValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
}
