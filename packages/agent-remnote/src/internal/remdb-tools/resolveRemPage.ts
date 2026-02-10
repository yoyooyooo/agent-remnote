import { z, type ZodRawShape } from 'zod';

import { withResolvedDatabase, parseOrThrow } from './shared.js';

const inputShape = {
  ids: z.array(z.string().min(1)).min(1, 'ids is required (at least 1)').describe('List of Rem IDs to resolve'),
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
  maxHops: z.number().int().min(1).max(500).optional().describe('Max upward hops (default 200)'),
  detail: z.boolean().optional().describe('Include full chain (default false)'),
} satisfies ZodRawShape;

export const resolveRemPageSchema = z.object(inputShape);
export type ResolveRemPageInput = z.infer<typeof resolveRemPageSchema>;

type ResolveRemPageItem = {
  id: string;
  found: boolean;
  pageId: string;
  hops: number;
  truncated: boolean;
  cycle_detected: boolean;
  chain?: readonly string[];
};

function normalizeParent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildMarkdown(results: readonly ResolveRemPageItem[]) {
  const lines: string[] = ['# Page Resolution'];
  for (const r of results) {
    if (!r.found) {
      lines.push(`- ${r.id} -> (not found)`);
      continue;
    }
    if (r.pageId) {
      const suffix = r.truncated ? '（truncated）' : r.cycle_detected ? '（cycle）' : '';
      lines.push(`- ${r.id} -> ${r.pageId}${suffix}`);
      continue;
    }
    const suffix = r.truncated ? 'truncated' : r.cycle_detected ? 'cycle' : 'unknown';
    lines.push(`- ${r.id} -> (pageId not resolved, ${suffix})`);
  }
  return lines.join('\n');
}

export async function executeResolveRemPage(params: ResolveRemPageInput) {
  const parsed = parseOrThrow(resolveRemPageSchema, params, { label: 'resolve_rem_page' });
  const maxHops = parsed.maxHops ?? 200;
  const detail = parsed.detail ?? false;

  const { result, info } = await withResolvedDatabase(parsed.dbPath, async (db) => {
    const stmt = db.prepare(`SELECT json_extract(doc, '$.parent') AS parent FROM quanta WHERE _id = ?`);

    const resolveOne = (id: string): ResolveRemPageItem => {
      const rootId = id.trim();
      if (!rootId) {
        return { id, found: false, pageId: '', hops: 0, truncated: false, cycle_detected: false };
      }

      const visited = new Set<string>();
      const chain: string[] = [];

      let current: string | null = rootId;
      for (let hops = 0; hops <= maxHops; hops++) {
        if (!current) break;
        if (visited.has(current)) {
          const item: ResolveRemPageItem = {
            id: rootId,
            found: true,
            pageId: '',
            hops: Math.max(0, chain.length - 1),
            truncated: false,
            cycle_detected: true,
          };
          if (detail) item.chain = chain.slice();
          return item;
        }
        visited.add(current);
        chain.push(current);

        const row = stmt.get(current) as { parent: unknown } | undefined;
        if (!row) {
          // If the root id itself doesn't exist: found=false.
          // If an ancestor is missing: found=true but pageId unresolved.
          if (chain.length <= 1) {
            const item: ResolveRemPageItem = {
              id: rootId,
              found: false,
              pageId: '',
              hops: 0,
              truncated: false,
              cycle_detected: false,
            };
            if (detail) item.chain = chain.slice();
            return item;
          }
          const item: ResolveRemPageItem = {
            id: rootId,
            found: true,
            pageId: '',
            hops: Math.max(0, chain.length - 1),
            // Parent chain is broken, treat as unresolved.
            truncated: true,
            cycle_detected: false,
          };
          if (detail) item.chain = chain.slice();
          return item;
        }

        const parent = normalizeParent(row.parent);
        if (!parent) {
          const item: ResolveRemPageItem = {
            id: rootId,
            found: true,
            pageId: current,
            hops: Math.max(0, chain.length - 1),
            truncated: false,
            cycle_detected: false,
          };
          if (detail) item.chain = chain.slice();
          return item;
        }
        current = parent;
      }

      const item: ResolveRemPageItem = {
        id: rootId,
        found: true,
        pageId: '',
        hops: Math.max(0, chain.length - 1),
        truncated: true,
        cycle_detected: false,
      };
      if (detail) item.chain = chain.slice();
      return item;
    };

    const results = parsed.ids.map(resolveOne);
    return { results };
  });

  const markdown = buildMarkdown(result.results);

  return {
    dbPath: info.dbPath,
    resolution: info.source,
    dirName: info.dirName,
    count: result.results.length,
    results: result.results,
    markdown,
  };
}
