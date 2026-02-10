import { z, type ZodRawShape } from 'zod';

import { parseOrThrow, withResolvedDatabase, safeJsonParse, type BetterSqliteInstance } from './shared.js';
import { executeListRemReferences, listRemReferencesSchema } from './listRemReferences.js';
import { executeFindRemsByReference } from './findRemsByReference.js';
import { TIME_RANGE_PATTERN, timeValueSchema } from './timeFilters.js';

const inputShape = {
  id: listRemReferencesSchema.shape.id.describe('Root Rem ID'),
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
  includeDescendants: z.boolean().optional().describe('Include descendants of the root Rem as anchors (default false)'),
  maxDepth: z.number().int().min(0).max(10).optional().describe('Max subtree depth to expand (default 0)'),
  includeOccurrences: z.boolean().optional().describe('Include per-occurrence details (default false)'),
  resolveText: z.boolean().optional().describe('Resolve text snippets (default true)'),
  inboundMaxDepth: z.number().int().min(1).max(3).optional().describe('Max inbound multi-hop depth (default 1)'),
  outboundMaxDepth: z.number().int().min(1).max(3).optional().describe('Max outbound multi-hop depth (default 1)'),
  inboundMaxCandidates: z.number().int().min(1).max(1000).optional().describe('Inbound candidate cap (default 200)'),
  // Optional pagination and graph output controls
  outboundLimit: z.number().int().min(1).max(2000).optional().describe('Outbound result cap (default 2000)'),
  outboundOffset: z.number().int().min(0).optional().describe('Outbound result offset'),
  inboundGraph: z.boolean().optional().describe('Output inbound multi-hop graph (default false)'),
  inboundGraphMode: z.enum(['auto', 'sql', 'scan']).optional().describe('Inbound graph mode (default auto)'),
  inboundLimit: z.number().int().min(1).max(2000).optional().describe('Inbound graph result cap (default 2000)'),
  inboundOffset: z.number().int().min(0).optional().describe('Inbound graph result offset'),
  inboundScanLimit: z
    .number()
    .int()
    .min(1000)
    .max(200000)
    .optional()
    .describe('Scan cap for inbound scan mode (default ~50k-200k)'),
  // Time filters (only applied to inbound graph; both SQL and scan try to filter)
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
} satisfies ZodRawShape;

export const getRemConnectionsSchema = z.object(inputShape);
export type GetRemConnectionsInput = z.infer<typeof getRemConnectionsSchema>;

export async function executeGetRemConnections(params: GetRemConnectionsInput) {
  const parsed = parseOrThrow(getRemConnectionsSchema, params, { label: 'get_rem_connections' });

  const { payload: referencePayload, suggestions: baseSuggestions } = await executeListRemReferences({
    id: parsed.id,
    dbPath: parsed.dbPath,
    includeDescendants: parsed.includeDescendants,
    maxDepth: parsed.maxDepth,
    includeOccurrences: parsed.includeOccurrences,
    resolveText: parsed.resolveText,
    includeInbound: true,
    inboundMaxDepth: parsed.inboundMaxDepth,
    inboundMaxCandidates: parsed.inboundMaxCandidates,
  });

  const outbound = referencePayload.references ?? [];
  const inbound = referencePayload.inbound ?? [];

  // Optional: expand outbound multi-hop (reference edges), up to 3 hops.
  let outboundExpanded:
    | undefined
    | {
        depthApplied: number;
        nodes: Array<{
          id: string;
          depth: number;
          via: string | null;
          title: string | null;
          snippet: string | null;
          ancestor: string | null;
        }>;
        count: number;
        edges: Array<{ from: string; to: string; depth: number }>;
      };
  const outboundMaxDepth = params.outboundMaxDepth ?? 1;
  if (outboundMaxDepth > 1) {
    try {
      const res = await computeOutboundBfs({
        dbPath: parsed.dbPath,
        startIds: [parsed.id],
        outboundMaxDepth,
        includeDescendants: parsed.includeDescendants ?? false,
        sourceTreeDepth: parsed.maxDepth ?? 0,
        limit: params.outboundLimit,
        offset: params.outboundOffset,
      });
      outboundExpanded = res;
    } catch {}
  }

  // Optional: inbound multi-hop graph output (SQL/SCAN implementations; auto prefers SQL and falls back to scan).
  let inboundGraph:
    | undefined
    | {
        depthApplied: number;
        nodes: Array<{
          id: string;
          depth: number;
          via: string | null;
          title: string | null;
          snippet: string | null;
          ancestor: string | null;
        }>;
        count: number;
        edges: Array<{ from: string; to: string; depth: number }>;
      };
  const enableInboundGraph = params.inboundGraph === true;
  if (enableInboundGraph) {
    try {
      const mode = params.inboundGraphMode || 'auto';
      if (mode === 'sql' || mode === 'auto') {
        const sqlRes = await computeInboundGraphSql({
          dbPath: parsed.dbPath,
          startIds: [parsed.id],
          inboundMaxDepth: parsed.inboundMaxDepth ?? 1,
          includeDescendants: parsed.includeDescendants ?? false,
          sourceTreeDepth: parsed.maxDepth ?? 0,
          limit: params.inboundLimit,
          offset: params.inboundOffset,
          timeRange: params.timeRange,
          createdAfter: params.createdAfter,
          createdBefore: params.createdBefore,
          updatedAfter: params.updatedAfter,
          updatedBefore: params.updatedBefore,
        });
        inboundGraph = sqlRes;
        if (mode === 'auto') {
          const directInboundCount = inbound.length;
          const tooFew = (inboundGraph?.count ?? 0) === 0 && directInboundCount > 0;
          if (tooFew) {
            const scanRes = await computeInboundGraphScan({
              dbPath: parsed.dbPath,
              startIds: [parsed.id],
              inboundMaxDepth: parsed.inboundMaxDepth ?? 1,
              includeDescendants: parsed.includeDescendants ?? false,
              sourceTreeDepth: parsed.maxDepth ?? 0,
              limit: params.inboundLimit,
              offset: params.inboundOffset,
              scanLimit: params.inboundScanLimit,
              timeRange: params.timeRange,
              createdAfter: params.createdAfter,
              createdBefore: params.createdBefore,
              updatedAfter: params.updatedAfter,
              updatedBefore: params.updatedBefore,
            });
            inboundGraph = scanRes;
          }
        }
      } else {
        const scanRes = await computeInboundGraphScan({
          dbPath: parsed.dbPath,
          startIds: [parsed.id],
          inboundMaxDepth: parsed.inboundMaxDepth ?? 1,
          includeDescendants: parsed.includeDescendants ?? false,
          sourceTreeDepth: parsed.maxDepth ?? 0,
          limit: params.inboundLimit,
          offset: params.inboundOffset,
          scanLimit: params.inboundScanLimit,
          timeRange: params.timeRange,
          createdAfter: params.createdAfter,
          createdBefore: params.createdBefore,
          updatedAfter: params.updatedAfter,
          updatedBefore: params.updatedBefore,
        });
        inboundGraph = scanRes;
      }
    } catch {}
  }

  const guidance =
    outbound.length + inbound.length > 0
      ? `Collected connections for Rem ${referencePayload.remId}: outbound ${outbound.length}, inbound ${inbound.length}.`
      : `No outbound or inbound references found for Rem ${referencePayload.remId}.`;

  const payload = {
    ...referencePayload,
    guidance,
    outbound,
    inbound,
    outboundCount: outbound.length,
    inboundCount: inbound.length,
    outboundExpandedDepth: outboundExpanded?.depthApplied ?? 1,
    outboundExpandedCount: outboundExpanded?.count ?? 0,
    outboundExpandedNodes: outboundExpanded?.nodes ?? [],
    outboundExpandedEdges: outboundExpanded?.edges ?? [],
    inboundGraphDepth: inboundGraph?.depthApplied ?? undefined,
    inboundGraphCount: inboundGraph?.count ?? 0,
    inboundGraphNodes: inboundGraph?.nodes ?? [],
    inboundGraphEdges: inboundGraph?.edges ?? [],
  };

  const suggestions = [...baseSuggestions];
  if (outbound.length > 0) {
    pushSuggestion(suggestions, 'Outbound details: use outline_rem_subtree id=<refId> or inspect_rem_doc');
  }
  if ((payload as any).outboundExpandedCount > 0) {
    pushSuggestion(
      suggestions,
      `Outbound multi-hop enabled (depth ${(payload as any).outboundExpandedDepth}). For broader coverage, set outboundMaxDepth to ${(payload as any).outboundExpandedDepth < 3 ? (payload as any).outboundExpandedDepth + 1 : 3}`,
    );
  } else if (outboundMaxDepth > 1) {
    pushSuggestion(
      suggestions,
      'No multi-hop outbound references found. Try increasing outboundMaxDepth or expanding anchors (includeDescendants=true)',
    );
  }
  if (enableInboundGraph) {
    if ((payload as any).inboundGraphCount > 0) {
      pushSuggestion(
        suggestions,
        `Inbound multi-hop graph enabled (depth ${(payload as any).inboundGraphDepth}). Adjust inboundLimit/offset to paginate`,
      );
    } else {
      pushSuggestion(
        suggestions,
        'No inbound multi-hop results found. Try increasing inboundMaxDepth or expanding anchors (includeDescendants=true)',
      );
    }
  }
  if (inbound.length > 0) {
    pushSuggestion(suggestions, 'Inbound context: call outline_rem_subtree on inbound.remId with includeEmpty=true');
  }

  return { ...payload, next: suggestions };
}

// --- Internal helpers (outbound BFS) ---

async function computeOutboundBfs(args: {
  dbPath?: string;
  startIds: string[];
  outboundMaxDepth: number;
  includeDescendants: boolean;
  sourceTreeDepth: number;
  limit?: number;
  offset?: number;
}): Promise<{
  depthApplied: number;
  nodes: Array<{
    id: string;
    depth: number;
    via: string | null;
    title: string | null;
    snippet: string | null;
    ancestor: string | null;
  }>;
  count: number;
  edges: Array<{ from: string; to: string; depth: number }>;
}> {
  const { result } = await withResolvedDatabase(args.dbPath, (db) => {
    const start = new Set<string>(args.startIds);
    if (args.includeDescendants && args.sourceTreeDepth > 0) {
      for (const id of expandDescendants(db, args.startIds, args.sourceTreeDepth)) start.add(id);
    }

    const visited = new Set<string>(start);
    const nodes = new Map<string, { id: string; depth: number; via: string | null }>();
    const edges: Array<{ from: string; to: string; depth: number }> = [];

    let depth = 1;
    let frontier = new Set<string>(start);
    const limit = Math.max(1, Math.min(args.limit ?? 2000, 2000));

    while (frontier.size > 0 && depth <= args.outboundMaxDepth && edges.length < limit) {
      const next = new Set<string>();
      for (const fromId of frontier) {
        const targets = getDirectOutboundRefs(db, fromId);
        for (const toId of targets) {
          edges.push({ from: fromId, to: toId, depth });
          if (!visited.has(toId)) {
            visited.add(toId);
            next.add(toId);
            if (!nodes.has(toId)) nodes.set(toId, { id: toId, depth, via: fromId });
          }
          if (edges.length >= limit) break;
        }
        if (edges.length >= limit) break;
      }
      if (edges.length >= limit) break;
      frontier = next;
      depth += 1;
    }

    const all = Array.from(nodes.values());
    const offset = Math.max(0, args.offset ?? 0);
    const sliced = all.slice(offset, Math.min(offset + limit, all.length));
    const details = enrichNodeDetails(db, sliced);

    return {
      nodes: details,
      edges,
      depthApplied: Math.min(depth - 1, args.outboundMaxDepth),
      total: all.length,
    };
  });

  return {
    depthApplied: result.depthApplied,
    nodes: result.nodes,
    count: result.nodes.length,
    edges: result.edges,
  };
}

function expandDescendants(db: BetterSqliteInstance, roots: string[], maxDepth: number): string[] {
  if (!roots || roots.length === 0 || maxDepth <= 0) return [];
  const placeholders = roots.map(() => '?').join(',');
  const sql = `WITH RECURSIVE tree(id, depth) AS (
    SELECT _id, 0 FROM quanta WHERE _id IN (${placeholders})
    UNION ALL
    SELECT child._id, tree.depth + 1
    FROM quanta child
    JOIN tree ON json_extract(child.doc, '$.parent') = tree.id
    WHERE tree.depth + 1 <= ?
  )
  SELECT id FROM tree WHERE depth > 0`;
  const rows = db.prepare(sql).all(...roots, maxDepth) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

function getDirectOutboundRefs(db: BetterSqliteInstance, id: string): Set<string> {
  const row = db.prepare('SELECT doc FROM quanta WHERE _id = ?').get(id) as { doc: string } | undefined;
  if (!row) return new Set();
  const doc = safeJsonParse<Record<string, unknown>>(row.doc);
  const refs = new Set<string>();
  if (!doc) return refs;
  collectReferences(doc.key, refs);
  if (doc.value !== undefined) collectReferences(doc.value, refs);
  return refs;
}

function collectReferences(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, into));
    return;
  }
  if (value && typeof value === 'object') {
    const maybe = value as Record<string, unknown>;
    if ((maybe.i === 'q' || maybe.i === 'p') && typeof maybe._id === 'string') {
      into.add(maybe._id);
      return;
    }
    for (const child of Object.values(maybe)) collectReferences(child, into);
  }
}

function enrichNodeDetails(
  db: BetterSqliteInstance,
  nodes: Array<{ id: string; depth: number; via: string | null }>,
): Array<{
  id: string;
  depth: number;
  via: string | null;
  title: string | null;
  snippet: string | null;
  ancestor: string | null;
}> {
  if (nodes.length === 0) return [];
  const stmt = db.prepare(
    `SELECT
      id,
      json_extract(doc, '$.kt') AS plainText,
      ancestor_not_ref_text AS ancestorText
    FROM remsSearchInfos
    WHERE id = ?`,
  );
  const fallback = db.prepare('SELECT doc FROM quanta WHERE _id = ?');

  const out: Array<{
    id: string;
    depth: number;
    via: string | null;
    title: string | null;
    snippet: string | null;
    ancestor: string | null;
  }> = [];
  for (const n of nodes) {
    let title: string | null = null;
    let snippet: string | null = null;
    let ancestor: string | null = null;

    const info = stmt.get(n.id) as { id: string; plainText: string | null; ancestorText: string | null } | undefined;
    if (info) {
      title = (info.plainText ?? '').trim() || null;
      snippet = title;
      ancestor = info.ancestorText ? info.ancestorText.trim() : null;
    } else {
      const row = fallback.get(n.id) as { doc: string } | undefined;
      if (row) {
        const parsed = safeJsonParse<Record<string, unknown>>(row.doc);
        const rawKey = parsed?.key;
        if (Array.isArray(rawKey)) {
          const text = rawKey
            .map((x) => (typeof x === 'string' ? x : ''))
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
          if (text) {
            title = text;
            snippet = text;
          }
        }
      }
    }

    out.push({ ...n, title, snippet, ancestor });
  }
  return out;
}

// --- Internal helpers (inbound graph via direct JSON token scan) ---

async function computeInboundGraphScan(args: {
  dbPath?: string;
  startIds: string[];
  inboundMaxDepth: number;
  includeDescendants: boolean;
  sourceTreeDepth: number;
  limit?: number;
  offset?: number;
  scanLimit?: number;
  timeRange?: string;
  createdAfter?: number | string;
  createdBefore?: number | string;
  updatedAfter?: number | string;
  updatedBefore?: number | string;
}): Promise<{
  depthApplied: number;
  nodes: Array<{
    id: string;
    depth: number;
    via: string | null;
    title: string | null;
    snippet: string | null;
    ancestor: string | null;
  }>;
  count: number;
  edges: Array<{ from: string; to: string; depth: number }>;
}> {
  const { result } = await withResolvedDatabase(args.dbPath, async (db) => {
    const start = new Set<string>(args.startIds);
    if (args.includeDescendants && args.sourceTreeDepth > 0) {
      for (const id of expandDescendants(db, args.startIds, args.sourceTreeDepth)) start.add(id);
    }

    const visited = new Set<string>();
    const edges: Array<{ from: string; to: string; depth: number }> = [];
    const nodeMap = new Map<string, { id: string; depth: number; via: string | null }>();

    let depth = 1;
    let frontier = new Set<string>(Array.from(start));
    const limit = Math.max(1, Math.min(args.limit ?? 2000, 2000));
    const scanLimit = Math.max(1000, Math.min(args.scanLimit ?? 50000, 200000));

    while (frontier.size > 0 && depth <= args.inboundMaxDepth && edges.length < limit) {
      const next = new Set<string>();
      for (const target of frontier) {
        const sources = getDirectInboundRefs(db, target, scanLimit, {
          timeRange: args.timeRange,
          createdAfter: args.createdAfter,
          createdBefore: args.createdBefore,
          updatedAfter: args.updatedAfter,
          updatedBefore: args.updatedBefore,
        });
        for (const src of sources) {
          edges.push({ from: src, to: target, depth });
          if (!visited.has(src)) {
            visited.add(src);
            next.add(src);
            if (!nodeMap.has(src)) nodeMap.set(src, { id: src, depth, via: target });
          }
          if (edges.length >= limit) break;
        }
        if (edges.length >= limit) break;
      }
      if (edges.length >= limit) break;
      frontier = next;
      depth += 1;
    }

    const all = Array.from(nodeMap.values());
    const offset = Math.max(0, args.offset ?? 0);
    const sliced = all.slice(offset, Math.min(offset + limit, all.length));
    const details = enrichNodeDetails(db, sliced);

    return {
      nodes: details,
      edges,
      depthApplied: Math.min(depth - 1, args.inboundMaxDepth),
      total: all.length,
    };
  });

  return {
    depthApplied: result.depthApplied,
    nodes: result.nodes,
    count: result.nodes.length,
    edges: result.edges,
  };
}

function getDirectInboundRefs(
  db: BetterSqliteInstance,
  targetId: string,
  scanLimit: number,
  filters?: {
    timeRange?: string;
    createdAfter?: number | string;
    createdBefore?: number | string;
    updatedAfter?: number | string;
    updatedBefore?: number | string;
  },
): Set<string> {
  const out = new Set<string>();
  const needle = `"_id":"${targetId}"`;
  try {
    const stmt = db.prepare('SELECT _id, doc FROM quanta WHERE doc LIKE ? LIMIT ?');
    for (const row of stmt.iterate(`%${needle}%`, scanLimit) as any) {
      const doc = safeJsonParse<Record<string, unknown>>(row.doc);
      if (!doc) continue;
      if (!matchTimeFilters(doc, filters)) continue;
      const refs = new Set<string>();
      collectReferences(doc.key, refs);
      if ((doc as any).value !== undefined) collectReferences((doc as any).value, refs);
      if (refs.has(targetId)) out.add(row._id as string);
    }
  } catch {}
  return out;
}

function matchTimeFilters(
  doc: Record<string, unknown>,
  filters?: {
    timeRange?: string;
    createdAfter?: number | string;
    createdBefore?: number | string;
    updatedAfter?: number | string;
    updatedBefore?: number | string;
  },
) {
  if (!filters) return true;
  const created = pickTs(doc, ['createdAt', 'c', 'ct']);
  const updated = pickTs(doc, ['m', 'lm', 'createdAt']);
  const ca = normalizeMaybeTs(filters.createdAfter);
  const cb = normalizeMaybeTs(filters.createdBefore);
  const ua = normalizeMaybeTs(filters.updatedAfter);
  const ub = normalizeMaybeTs(filters.updatedBefore);
  if (ca != null && created != null && created < ca) return false;
  if (cb != null && created != null && created > cb) return false;
  if (ua != null && updated != null && updated < ua) return false;
  if (ub != null && updated != null && updated > ub) return false;
  return true;
}

function pickTs(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v: any = (obj as any)[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeMaybeTs(v: number | string | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// SQL inbound graph (fast; accuracy depends on indexes and query coverage).
async function computeInboundGraphSql(args: {
  dbPath?: string;
  startIds: string[];
  inboundMaxDepth: number;
  includeDescendants: boolean;
  sourceTreeDepth: number;
  limit?: number;
  offset?: number;
  timeRange?: string;
  createdAfter?: number | string;
  createdBefore?: number | string;
  updatedAfter?: number | string;
  updatedBefore?: number | string;
}): Promise<{
  depthApplied: number;
  nodes: Array<{
    id: string;
    depth: number;
    via: string | null;
    title: string | null;
    snippet: string | null;
    ancestor: string | null;
  }>;
  count: number;
  edges: Array<{ from: string; to: string; depth: number }>;
}> {
  const { result } = await withResolvedDatabase(args.dbPath, async (db) => {
    const start = new Set<string>(args.startIds);
    if (args.includeDescendants && args.sourceTreeDepth > 0) {
      for (const id of expandDescendants(db, args.startIds, args.sourceTreeDepth)) start.add(id);
    }
    const inbound = await executeFindRemsByReference({
      targetIds: Array.from(start),
      maxDepth: args.inboundMaxDepth,
      limit: Math.max(1, Math.min(args.limit ?? 2000, 2000)),
      offset: Math.max(0, args.offset ?? 0),
      dbPath: args.dbPath,
      detail: true,
      timeRange: args.timeRange as any,
      createdAfter: args.createdAfter as any,
      createdBefore: args.createdBefore as any,
      updatedAfter: args.updatedAfter as any,
      updatedBefore: args.updatedBefore as any,
    });
    const nodes = (inbound.matches as any[]).map((m) => ({
      id: m.id,
      depth: m.depth ?? 0,
      via: Array.isArray(m.matchedTargets) && m.matchedTargets.length > 0 ? m.matchedTargets[0] : null,
      title: m.title ?? null,
      snippet: m.snippet ?? null,
      ancestor: m.ancestor ?? null,
    }));
    const edges: Array<{ from: string; to: string; depth: number }> = [];
    for (const m of inbound.matches as any[]) {
      const tos = Array.isArray(m.matchedTargets) ? m.matchedTargets : [];
      for (const t of tos) edges.push({ from: m.id, to: t, depth: m.depth ?? 0 });
    }
    return {
      nodes,
      edges,
      depthApplied: inbound.depthApplied,
      total: inbound.totalCount,
    };
  });

  return {
    depthApplied: result.depthApplied,
    nodes: result.nodes,
    count: result.nodes.length,
    edges: result.edges,
  };
}

function pushSuggestion(list: string[], text: string) {
  if (!list.includes(text)) {
    list.push(text);
  }
}
