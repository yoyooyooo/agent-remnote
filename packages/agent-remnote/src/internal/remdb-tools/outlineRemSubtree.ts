import { z, type ZodRawShape } from 'zod';

import {
  summarizeKey,
  safeJsonParse,
  withResolvedDatabase,
  parseOrThrow,
  type BetterSqliteInstance,
  SYSTEM_REM_IDS,
  SYSTEM_REM_KEYS,
} from './shared.js';

type OutlineFormat = 'json' | 'markdown';

type OutlineNodeKind = 'rem' | 'portal';

type OutlineTarget = {
  id: string;
  text: string | null;
  resolved: boolean;
};

type OutlineNode = {
  id: string;
  depth: number;
  kind: OutlineNodeKind;
  sortKey: string | null;
  parentId: string | null;
  text: string;
  target: OutlineTarget | null;
  references: string[];
  rawKey: unknown;
};

type OutlineOptions = {
  rootId: string;
  maxDepth: number;
  includeEmpty: boolean;
  expandReferences: boolean;
  maxReferenceDepth: number;
  excludeProperties: boolean;
};

type OutlineTargetDescriptor = {
  kind: 'portal' | 'reference';
  id: string;
};

const inputShape = {
  id: z.string().min(1, 'id is required').describe('Root Rem ID'),
  maxDepth: z.number().int().min(0).max(10).optional().describe('Max depth to expand (default 5)'),
  includeEmpty: z.boolean().optional().describe('Include empty nodes (default false)'),
  expandReferences: z.boolean().optional().describe('Expand [[references]] text (default true)'),
  maxReferenceDepth: z.number().int().min(0).max(5).optional().describe('Max reference expansion depth (default 1)'),
  format: z.enum(['json', 'markdown']).optional().describe('Response format: json/markdown (default markdown)'),
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
  startOffset: z.number().int().min(0).optional().describe('Start node offset for pagination (default 0)'),
  maxNodes: z.number().int().min(1).max(1000).optional().describe('Max nodes to return (default 80)'),
  excludeProperties: z.boolean().optional().describe('Exclude table property/option nodes (default false)'),
  detail: z.boolean().optional().describe('Include full node details in json format (default false)'),
} satisfies ZodRawShape;

export const outlineRemSubtreeSchema = z.object(inputShape);
export type OutlineRemSubtreeInput = z.infer<typeof outlineRemSubtreeSchema>;

export async function executeOutlineRemSubtree(params: OutlineRemSubtreeInput) {
  const parsed = parseOrThrow(outlineRemSubtreeSchema, params, { label: 'outline_rem_subtree' });
  const { result, info } = await withResolvedDatabase(parsed.dbPath, async (db) =>
    executeOutlineRemSubtreeWithDb(db, parsed),
  );
  return { dbPath: info.dbPath, resolution: info.source, dirName: info.dirName, ...result };
}

export async function executeOutlineRemSubtreeWithDb(db: BetterSqliteInstance, params: OutlineRemSubtreeInput) {
  const parsed = parseOrThrow(outlineRemSubtreeSchema, params, { label: 'outline_rem_subtree' });
  const maxDepth = parsed.maxDepth ?? 5;
  const includeEmpty = parsed.includeEmpty ?? false;
  const expandReferences = parsed.expandReferences ?? true;
  const maxReferenceDepth = parsed.maxReferenceDepth ?? 1;
  const format: OutlineFormat = parsed.format ?? 'markdown';
  const offset = parsed.startOffset ?? 0;
  const maxNodes = parsed.maxNodes ?? 80;
  const excludeProperties = parsed.excludeProperties ?? false;
  const detail = parsed.detail ?? false;

  const nodes = fetchOutlineNodes(db, {
    rootId: parsed.id,
    maxDepth,
    includeEmpty,
    expandReferences,
    maxReferenceDepth,
    excludeProperties,
  });

  const sliced = nodes.slice(offset, offset + maxNodes);
  const markdown = format === 'markdown' ? toMarkdown(sliced) : undefined;

  const title = nodes[0]?.text ?? parsed.id;
  const nodeCount = sliced.length;
  const total = nodes.length;
  const hasMore = offset + nodeCount < total;

  const response = {
    rootId: parsed.id,
    title,
    maxDepth,
    nodeCount,
    totalNodeCount: total,
    offset,
    maxNodes,
    hasMore,
    nextOffset: hasMore ? offset + nodeCount : null,
    excludeProperties,
    markdown,
  };
  if (format === 'json') {
    return {
      ...response,
      tree: detail ? sliced : simplifyOutlineNodes(sliced),
    };
  }
  if (detail) {
    return { ...response, tree: sliced };
  }
  return response;
}

function fetchOutlineNodes(db: BetterSqliteInstance, options: OutlineOptions): OutlineNode[] {
  const baseQuery = `WITH RECURSIVE tree(id, depth, order_path) AS (
      SELECT _id, 0 AS depth, COALESCE(json_extract(doc, '$.f'), '')
      FROM quanta WHERE _id = @rootId
      UNION ALL
      SELECT child._id,
             tree.depth + 1,
             tree.order_path || char(0) || COALESCE(json_extract(child.doc, '$.f'), '')
      FROM quanta child
      JOIN tree ON json_extract(child.doc, '$.parent') = tree.id
      WHERE tree.depth + 1 <= @maxDepth
    )
    SELECT tree.id,
           tree.depth,
           tree.order_path AS orderPath,
           quanta.doc AS doc
    FROM tree
    JOIN quanta ON quanta._id = tree.id
    ORDER BY tree.order_path`;

  const indexedQuery = baseQuery.replace('FROM quanta child', 'FROM quanta child INDEXED BY json_quanta_parent');

  const stmt = (() => {
    try {
      return db.prepare(indexedQuery);
    } catch (error) {
      const message = String(error ?? '');
      if (/no such index/i.test(message)) {
        return db.prepare(baseQuery);
      }
      throw error;
    }
  })();

  const rows = stmt.all({ rootId: options.rootId, maxDepth: options.maxDepth }) as Array<{
    id: string;
    depth: number;
    orderPath: string;
    doc: string;
  }>;

  const nodes: OutlineNode[] = [];
  const targetStmt = db.prepare('SELECT doc FROM quanta WHERE _id = ?');
  const targetCache = new Map<string, OutlineTarget>();

  for (const row of rows) {
    const doc = safeJsonParse<Record<string, unknown>>(row.doc);
    const rawKey = doc?.key;
    const targetDescriptor = findOutlineTargetDescriptor(doc, rawKey);
    const target = targetDescriptor
      ? (targetCache.get(targetDescriptor.id) ??
        (() => {
          const resolved = resolveOutlineTarget(targetStmt, db, targetDescriptor.id);
          targetCache.set(targetDescriptor.id, resolved);
          return resolved;
        })())
      : null;
    const kind: OutlineNodeKind = targetDescriptor?.kind === 'portal' ? 'portal' : 'rem';
    const keySummary = summarizeKey(rawKey, db, {
      expand: options.expandReferences,
      maxDepth: options.maxReferenceDepth,
    });
    const text = renderOutlineNodeText(kind, keySummary.text, target);

    if (!options.includeEmpty && !text && row.depth !== 0) {
      continue;
    }

    const isSystemRem = SYSTEM_REM_IDS.has(row.id) || SYSTEM_REM_KEYS.has(keySummary.text);
    if (isSystemRem) {
      continue;
    }

    if (options.excludeProperties) {
      const rcrs = typeof doc?.rcrs === 'string' ? doc.rcrs : null;
      const rcre = typeof doc?.rcre === 'string' ? doc.rcre : null;
      if ((rcrs && rcrs.startsWith('t.')) || (rcre && rcre.startsWith('t.'))) {
        continue;
      }
    }

    nodes.push({
      id: row.id,
      depth: row.depth,
      kind,
      sortKey: typeof doc?.f === 'string' ? doc.f : null,
      parentId: typeof doc?.parent === 'string' ? doc.parent : null,
      text,
      target,
      references: keySummary.references,
      rawKey,
    });
  }

  return nodes;
}

function simplifyOutlineNodes(nodes: OutlineNode[]) {
  return nodes.map((node) => ({
    id: node.id,
    depth: node.depth,
    kind: node.kind,
    text: node.text,
    target: node.target,
    references: node.references,
  }));
}

function toMarkdown(nodes: OutlineNode[]): string {
  return nodes
    .map((node) => {
      const indent = '  '.repeat(node.depth);
      const text = node.text || '(empty)';
      return `${indent}- ${text}`;
    })
    .join('\n');
}

function findOutlineTargetDescriptor(doc: Record<string, unknown> | null | undefined, value: unknown): OutlineTargetDescriptor | null {
  const docType = typeof doc?.type === 'number' ? doc.type : typeof doc?.type === 'string' ? Number(doc.type) : NaN;
  const pdRaw = doc?.pd;
  if (docType === 6 && pdRaw && typeof pdRaw === 'object' && !Array.isArray(pdRaw)) {
    const pdKeys = Object.keys(pdRaw as Record<string, unknown>).map((key) => key.trim()).filter(Boolean);
    if (pdKeys.length > 0) {
      return { kind: 'portal', id: pdKeys[0]! };
    }
  }

  const referenceFallback = (() => {
    if (!Array.isArray(value) || value.length !== 1) return null;
    const only = value[0];
    if (!only || typeof only !== 'object') return null;
    const obj = only as Record<string, unknown>;
    const tokenType = typeof obj.i === 'string' ? obj.i : '';
    const targetId = typeof obj._id === 'string' ? obj._id.trim() : '';
    return tokenType === 'q' && targetId ? ({ kind: 'reference', id: targetId } as const) : null;
  })();

  const visit = (input: unknown): OutlineTargetDescriptor | null => {
    if (Array.isArray(input)) {
      for (const item of input) {
        const found = visit(item);
        if (found?.kind === 'portal') return found;
      }
      return null;
    }

    if (input && typeof input === 'object') {
      const obj = input as Record<string, unknown>;
      const tokenType = typeof obj.i === 'string' ? obj.i : '';
      const targetId = typeof obj._id === 'string' ? obj._id.trim() : '';
      if (tokenType === 'p' && targetId) {
        return { kind: 'portal', id: targetId };
      }

      for (const child of Object.values(obj)) {
        const found = visit(child);
        if (found?.kind === 'portal') return found;
      }
    }

    return null;
  };

  const portal = visit(value);
  return portal ?? referenceFallback;
}

function resolveOutlineTarget(stmt: any, db: BetterSqliteInstance, targetId: string): OutlineTarget {
  const row = stmt.get(targetId) as { doc?: string } | undefined;
  if (!row?.doc) {
    return { id: targetId, text: null, resolved: false };
  }

  const parsed = safeJsonParse<{ key?: unknown }>(row.doc);
  const summary = summarizeKey(parsed?.key, db, { expand: false, maxDepth: 0 });
  const text = typeof summary.text === 'string' ? summary.text : null;
  return { id: targetId, text, resolved: true };
}

function renderOutlineNodeText(kind: OutlineNodeKind, fallbackText: string, target: OutlineTarget | null): string {
  if (kind === 'portal' && target) {
    if (!target.resolved) {
      return `Portal -> {ref:${target.id}}`;
    }
    return `Portal -> ${target.text && target.text.length > 0 ? target.text : '(empty)'}`;
  }
  return fallbackText;
}
