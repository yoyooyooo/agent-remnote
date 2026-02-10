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

type OutlineNode = {
  id: string;
  depth: number;
  sortKey: string | null;
  parentId: string | null;
  text: string;
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

  for (const row of rows) {
    const doc = safeJsonParse<Record<string, unknown>>(row.doc);
    const rawKey = doc?.key;
    const keySummary = summarizeKey(rawKey, db, {
      expand: options.expandReferences,
      maxDepth: options.maxReferenceDepth,
    });

    if (!options.includeEmpty && !keySummary.text && row.depth !== 0) {
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
      sortKey: typeof doc?.f === 'string' ? doc.f : null,
      parentId: typeof doc?.parent === 'string' ? doc.parent : null,
      text: keySummary.text,
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
    text: node.text,
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
