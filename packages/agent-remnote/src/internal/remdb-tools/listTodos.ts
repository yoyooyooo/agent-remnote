import { z } from 'zod';

import { withResolvedDatabase, safeJsonParse, parseOrThrow, type BetterSqliteInstance } from './shared.js';
import { coalesceText, createPreview, stringifyAncestor } from './searchUtils.js';

// Defaults optimized for a personal vault (adjust/extend as needed).
const DEFAULT_KNOWN = {
  // Common header Tags (prefer if present)
  tagIds: [
    'ExWWcna6cyLPRSy3W', // Tasks (common title in Chinese vaults)
    'oZbSs7aaFPNTjLPMD', // Todo
    'J3yx9nbpeBW8S9q4v', // TODO
  ],
  // Known columns/options for the "Tasks" table (used as fallback when present)
  statusForTasks: {
    tagId: 'ExWWcna6cyLPRSy3W',
    statusAttrId: 'aQb9u7XMjFL96GGYc',
    unfinishedOptionId: 'jTCTqykroBRsA2vYm',
    finishedOptionId: 'CotJ4eARGeLvtLRBa',
  },
} as const;

export const listTodosInputSchema = z.object({
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
  status: z
    .enum(['unfinished', 'finished', 'all']) // lightweight enum
    .optional()
    .describe('Todo status filter (default unfinished)'),
  // Provide candidate header Tag IDs (higher priority than tagTitles)
  tagIds: z.array(z.string()).optional().describe('Preferred header Tag IDs'),
  // Discover header Tags by title (defaults include common aliases)
  tagTitles: z.array(z.string()).optional().describe('Discover header Tags by title (defaults include common aliases)'),
  // Prefer using only Todo/TODO tags when present (only when tagIds/tagTitles are not explicitly provided)
  preferTodoOnly: z.boolean().optional().describe('If Todo/TODO exists, use only that header (default false)'),
  // Always include tag-only rows for these titles even without a status column (default Todo/TODO)
  alwaysIncludeTagOnlyTitles: z
    .array(z.string())
    .optional()
    .describe('Always include tag-only rows for these titles (default [Todo, TODO])'),
  // Limit to an ancestor subtree
  ancestorId: z.string().optional().describe('Limit to an ancestor subtree'),
  includeDescendants: z.boolean().optional().describe('Include descendants (default true)'),
  // Candidate names for columns (used for auto-detection)
  statusAttrTitles: z.array(z.string()).optional().describe('Candidate names for the status column'),
  unfinishedOptionTitles: z.array(z.string()).optional().describe('Candidate names for the unfinished option'),
  finishedOptionTitles: z.array(z.string()).optional().describe('Candidate names for the finished option'),
  dueDateAttrTitles: z.array(z.string()).optional().describe('Candidate names for the due date column'),
  // Extra filters: due date bounds (ISO string or ms/sec timestamp)
  dueAfter: z.union([z.string(), z.number()]).optional().describe('Due date lower bound (ISO/ms/sec)'),
  dueBefore: z.union([z.string(), z.number()]).optional().describe('Due date upper bound (ISO/ms/sec)'),
  // Sorting: if due column exists default dueAsc, else updatedAtDesc
  sort: z
    .enum(['dueAsc', 'dueDesc', 'updatedAtAsc', 'updatedAtDesc', 'createdAtAsc', 'createdAtDesc']) // lightweight enum
    .optional()
    .describe('Sort order (default: dueAsc if due exists, else updatedAtDesc)'),
  // When Todo/TODO is included, prefer listing it first (default true)
  preferTodoFirst: z.boolean().optional().describe('Prefer Todo/TODO first when included (default true)'),
  limit: z.number().int().min(1).max(200).optional().describe('Max results to return (default 20)'),
  offset: z.number().int().min(0).optional().describe('Pagination offset (default 0)'),
  snippetLength: z.number().int().min(40).max(300).optional().describe('Snippet length (default 160)'),
  // When status=all and a Tag has no Status column, include tag-only rows (status cannot be inferred)
  includeTagOnlyWhenNoStatus: z
    .boolean()
    .optional()
    .describe('When status=all and no status column, include tag-only rows (default true)'),
});

export type ListTodosInput = z.infer<typeof listTodosInputSchema>;

export const listTodosSchema = listTodosInputSchema;

type PropertyContext = {
  properties: Array<{
    id: string;
    name: string;
    rawType: string | null;
    kind: string;
    options: Array<{ id: string; name: string; rowIds: Set<string> }>;
  }>;
  optionNameById: Map<string, string>;
};

type TagSchema = {
  tagId: string;
  tagName: string;
  statusAttrId?: string;
  unfinishedOptionId?: string;
  finishedOptionId?: string;
  dueDateAttrId?: string;
};

type RemMetadata = {
  id: string;
  aliasId: string;
  text: string;
  ancestorText: string | null;
  ancestorIds: string[];
  parentId: string | null;
  updatedAt: number | null;
  createdAt: number | null;
};

type ListTodosPayload = {
  dbPath: string;
  resolution: string;
  dirName?: string;
  guidance: string;
  status: 'unfinished' | 'finished' | 'all';
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  totalCandidates: number;
  totalMatched: number;
  usedSchemas: TagSchema[];
  items: Array<{
    id: string;
    title: string;
    snippet: string;
    truncated: boolean;
    ancestor: string | null;
    ancestorIds: string[];
    parentId: string | null;
    updatedAt: number | null;
    createdAt: number | null;
    source: 'table' | 'tag-only';
    tagId: string;
  }>;
};

export async function executeListTodos(params: ListTodosInput) {
  const parsed = parseOrThrow(listTodosInputSchema, params, { label: 'list_todos' });
  const status = parsed.status ?? 'unfinished';
  const limit = parsed.limit ?? 20;
  const offset = parsed.offset ?? 0;
  const snippetLength = parsed.snippetLength ?? 160;
  const includeDescendants = parsed.includeDescendants ?? true;
  const preferTodoOnly = parsed.preferTodoOnly ?? false;
  const alwaysIncludeTagOnlyTitles =
    parsed.alwaysIncludeTagOnlyTitles && parsed.alwaysIncludeTagOnlyTitles.length > 0
      ? parsed.alwaysIncludeTagOnlyTitles
      : ['Todo', 'TODO'];
  const includeTagOnlyWhenNoStatus = parsed.includeTagOnlyWhenNoStatus ?? true;

  // Default common titles/aliases (extend for your vault as needed)
  const tagTitles =
    parsed.tagTitles && parsed.tagTitles.length > 0
      ? parsed.tagTitles
      : ['待办', 'Todo', 'TODO', 'Tasks', 'Task', 'Todos', 'TODOs'];
  const statusAttrTitles =
    parsed.statusAttrTitles && parsed.statusAttrTitles.length > 0 ? parsed.statusAttrTitles : ['Status', '状态'];
  const unfinishedOptionTitles =
    parsed.unfinishedOptionTitles && parsed.unfinishedOptionTitles.length > 0
      ? parsed.unfinishedOptionTitles
      : ['Unfinished', '未完成'];
  const finishedOptionTitles =
    parsed.finishedOptionTitles && parsed.finishedOptionTitles.length > 0
      ? parsed.finishedOptionTitles
      : ['Finished', '已完成', 'Done', '完成'];
  const dueDateAttrTitles =
    parsed.dueDateAttrTitles && parsed.dueDateAttrTitles.length > 0
      ? parsed.dueDateAttrTitles
      : ['Due', 'Due Date', '截止', '截止日期', '到期', '到期日'];

  const sortPref = parsed.sort;
  const dueAfter = parsed.dueAfter;
  const dueBefore = parsed.dueBefore;
  const preferTodoFirst = parsed.preferTodoFirst ?? false;

  const { result, info } = await withResolvedDatabase(parsed.dbPath, async (db) => {
    // 1) Collect candidate Tags
    const tagIdSet = new Set<string>();
    if (Array.isArray(parsed.tagIds)) {
      for (const id of parsed.tagIds) tagIdSet.add(id);
    }

    // Inject known common Tags (add if present)
    for (const id of DEFAULT_KNOWN.tagIds) {
      if (remExists(db, id)) tagIdSet.add(id);
    }
    const discovered = discoverTagsByTitle(db, tagTitles);
    // If tagIds/tagTitles are not explicitly provided and preferTodoOnly=true, keep only Todo/TODO when present.
    if (!parsed.tagIds && !parsed.tagTitles && preferTodoOnly) {
      const todoOnly = discovered.filter((t) => /^(todo)$/i.test(t.name.trim()));
      if (todoOnly.length > 0) {
        for (const { id } of todoOnly) tagIdSet.add(id);
      } else {
        for (const { id } of discovered) tagIdSet.add(id);
      }
    } else {
      for (const { id } of discovered) tagIdSet.add(id);
    }
    const tagIds = Array.from(tagIdSet);

    if (tagIds.length === 0) {
      return {
        schemas: [] as TagSchema[],
        rows: [] as Array<{ id: string; tagId: string; source: 'table' | 'tag-only' }>,
        dueCandidate: undefined as string | undefined,
        items: [] as any[],
        totalCandidates: 0,
        totalMatched: 0,
        hasMore: false,
        nextOffset: null as number | null,
      };
    }

    // 2) Parse properties/options for each Tag (reusing the readRemTable approach)
    const schemas: TagSchema[] = [];
    for (const tagId of tagIds) {
      const tagDocRow = db.prepare('SELECT doc FROM quanta WHERE _id = ?').get(tagId) as { doc?: string } | undefined;
      if (!tagDocRow?.doc) continue;
      const tagDoc = safeJsonParse<Record<string, unknown>>(tagDocRow.doc);
      const tagName = summarizeTitle(tagDoc);

      const ctx = loadProperties(db, tagId);
      const schema: TagSchema = {
        tagId,
        tagName,
      };

      // Locate Status property and Unfinished/Finished options
      const statusProps = ctx.properties.filter(
        (p) =>
          p.kind === 'select' &&
          (statusAttrTitles.includes(p.name) ||
            p.options.some((o) => unfinishedOptionTitles.includes(o.name) || finishedOptionTitles.includes(o.name))),
      );
      const statusProp = statusProps[0];
      if (statusProp) {
        schema.statusAttrId = statusProp.id;
        const unfinishedOpt = statusProp.options.find((o) => unfinishedOptionTitles.includes(o.name));
        const finishedOpt = statusProp.options.find((o) => finishedOptionTitles.includes(o.name));
        if (unfinishedOpt) schema.unfinishedOptionId = unfinishedOpt.id;
        if (finishedOpt) schema.finishedOptionId = finishedOpt.id;
      }
      // If this Tag is "Tasks" and we failed to resolve columns/options, fall back to known defaults.
      if (
        schema.tagId === DEFAULT_KNOWN.statusForTasks.tagId &&
        (!schema.statusAttrId || !schema.unfinishedOptionId || !schema.finishedOptionId)
      ) {
        if (remExists(db, DEFAULT_KNOWN.statusForTasks.statusAttrId)) {
          schema.statusAttrId = schema.statusAttrId ?? DEFAULT_KNOWN.statusForTasks.statusAttrId;
        }
        if (remExists(db, DEFAULT_KNOWN.statusForTasks.unfinishedOptionId)) {
          schema.unfinishedOptionId = schema.unfinishedOptionId ?? DEFAULT_KNOWN.statusForTasks.unfinishedOptionId;
        }
        if (remExists(db, DEFAULT_KNOWN.statusForTasks.finishedOptionId)) {
          schema.finishedOptionId = schema.finishedOptionId ?? DEFAULT_KNOWN.statusForTasks.finishedOptionId;
        }
      }

      // Locate due date column (prefer date type; or match by title aliases)
      const dueProps = ctx.properties.filter((p) => p.kind === 'date' || dueDateAttrTitles.includes(p.name));
      const dueProp = dueProps[0];
      if (dueProp) schema.dueDateAttrId = dueProp.id;

      schemas.push(schema);
    }

    // 3) Collect candidate rows (strategy depends on status)
    const candidate: Array<{ id: string; tagId: string; source: 'table' | 'tag-only' }> = [];

    for (const schema of schemas) {
      const ctx = loadProperties(db, schema.tagId);
      const statusProp = schema.statusAttrId ? ctx.properties.find((p) => p.id === schema.statusAttrId) : undefined;

      if (status === 'unfinished' || status === 'finished') {
        // Use option mapping (pd) for fast lookup
        const optionId = status === 'unfinished' ? schema.unfinishedOptionId : schema.finishedOptionId;
        if (statusProp && optionId) {
          const option = statusProp.options.find((o) => o.id === optionId);
          let pushed = 0;
          if (option && option.rowIds.size > 0) {
            for (const rowId of option.rowIds) {
              candidate.push({ id: rowId, tagId: schema.tagId, source: 'table' });
              pushed++;
            }
          }
          if (pushed === 0) {
            const set = queryRowsByAttributeOption(db, schema.tagId, schema.statusAttrId!, optionId);
            for (const rowId of set) {
              candidate.push({ id: rowId, tagId: schema.tagId, source: 'table' });
            }
          }
        }
        // If there's no status property/option, skip this Tag (keep precision high)
      } else {
        // status = all
        // Prefer including rows that have a status column (presence of the Status cell)
        if (statusProp) {
          const set = queryRowsByAttributePresence(db, schema.tagId, schema.statusAttrId!);
          for (const rowId of set) {
            candidate.push({ id: rowId, tagId: schema.tagId, source: 'table' });
          }
        }
        // Optionally include tag-only rows (no status column)
        if (!statusProp && includeTagOnlyWhenNoStatus) {
          const rows = loadRows(db, schema.tagId, { limit: Math.min(limit * 4, 2000), offset: 0 });
          for (const row of rows.rows) {
            candidate.push({ id: row.id, tagId: schema.tagId, source: 'tag-only' });
          }
        }
      }

      // Regardless of status, include tag-only rows for titles in alwaysIncludeTagOnlyTitles (tag-only)
      if (alwaysIncludeTagOnlyTitles.some((t) => t.trim().toLowerCase() === schema.tagName.trim().toLowerCase())) {
        const rows = loadRows(db, schema.tagId, { limit: Math.min(limit * 4, 2000), offset: 0 });
        for (const row of rows.rows) {
          candidate.push({ id: row.id, tagId: schema.tagId, source: 'tag-only' });
        }
      }
    }

    // De-duplicate
    const merged = new Map<string, { id: string; tagId: string; source: 'table' | 'tag-only' }>();
    for (const item of candidate) {
      const prev = merged.get(item.id);
      if (!prev) {
        merged.set(item.id, item);
      } else {
        // Prefer keeping the table-sourced row
        if (prev.source === 'tag-only' && item.source === 'table') {
          merged.set(item.id, item);
        }
      }
    }

    const allIds = Array.from(merged.keys());

    // 4) Fetch metadata (text, ancestors, timestamps)
    const meta = fetchMetadata(db, allIds);

    // Ancestor scope filtering
    let filtered = allIds.filter((id) => {
      if (!parsed.ancestorId) return true;
      const m = meta.get(id);
      if (!m) return false;
      if (!includeDescendants) return m.parentId === parsed.ancestorId;
      return m.ancestorIds.includes(parsed.ancestorId) || m.parentId === parsed.ancestorId;
    });

    // 5) Due date filtering + sorting (due date first, otherwise updatedAt)
    // If multiple Tags exist, prefer the first schema that resolves due.
    const dueAttrId = schemas.find((s) => s.dueDateAttrId)?.dueDateAttrId;
    const dueValues = dueAttrId
      ? fetchAttributeSortValues(db, filtered, dueAttrId)
      : new Map<string, number | string | null>();

    if (dueAttrId && (dueAfter != null || dueBefore != null)) {
      const lower = dueAfter != null ? normalizeDateInput(dueAfter) : null;
      const upper = dueBefore != null ? normalizeDateInput(dueBefore) : null;
      filtered = filtered.filter((id) => {
        const v = dueValues.get(id);
        let ts: number | null = null;
        if (typeof v === 'number') ts = v;
        else if (typeof v === 'string') {
          const parsed = Date.parse(v);
          ts = Number.isFinite(parsed) ? parsed : null;
        }
        if (ts == null) return false;
        if (lower != null && ts < lower) return false;
        if (upper != null && ts > upper) return false;
        return true;
      });
    }

    // Default sort: updatedAt desc (newest first). For due-first, pass sort=dueAsc/desc explicitly.
    const sortMode = sortPref ?? 'updatedAtDesc';

    // Build Todo Tag set (titles Todo/TODO or known default Todo/TODO IDs)
    const todoTagIds = new Set<string>(
      schemas.filter((s) => s.tagName.trim().toLowerCase() === 'todo').map((s) => s.tagId),
    );
    // Merge known default Todo/TODO IDs
    for (const id of ['oZbSs7aaFPNTjLPMD', 'J3yx9nbpeBW8S9q4v']) todoTagIds.add(id);
    filtered.sort((a, b) => {
      const ma = meta.get(a);
      const mb = meta.get(b);
      const av = dueValues.get(a);
      const bv = dueValues.get(b);
      if (preferTodoFirst) {
        const srcA = merged.get(a);
        const srcB = merged.get(b);
        const pa = srcA && todoTagIds.has(srcA.tagId) ? 0 : 1;
        const pb = srcB && todoTagIds.has(srcB.tagId) ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      switch (sortMode) {
        case 'dueAsc': {
          // Values first, then missing; numeric asc / string asc
          const cmp = compareSortValues(av, bv);
          if (cmp !== 0) return cmp;
          return (mb?.updatedAt ?? 0) - (ma?.updatedAt ?? 0);
        }
        case 'dueDesc': {
          const cmp = compareSortValues(bv, av);
          if (cmp !== 0) return cmp;
          return (mb?.updatedAt ?? 0) - (ma?.updatedAt ?? 0);
        }
        case 'updatedAtAsc':
          return (ma?.updatedAt ?? 0) - (mb?.updatedAt ?? 0);
        case 'updatedAtDesc':
        default:
          return (mb?.updatedAt ?? 0) - (ma?.updatedAt ?? 0);
        case 'createdAtAsc': {
          const cmp = (ma?.createdAt ?? 0) - (mb?.createdAt ?? 0);
          if (cmp !== 0) return cmp;
          return (mb?.updatedAt ?? 0) - (ma?.updatedAt ?? 0);
        }
        case 'createdAtDesc': {
          const cmp = (mb?.createdAt ?? 0) - (ma?.createdAt ?? 0);
          if (cmp !== 0) return cmp;
          return (mb?.updatedAt ?? 0) - (ma?.updatedAt ?? 0);
        }
      }
    });

    const totalMatched = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);
    const hasMore = offset + limit < filtered.length;
    const nextOffset = hasMore ? offset + limit : null;

    // 6) Shape final result
    const items = paginated.map((id) => {
      const m = meta.get(id);
      const src = merged.get(id);
      const text = m?.text ?? '';
      const { title, snippet, truncated } = createPreview(text, snippetLength);
      return {
        id,
        title,
        snippet,
        truncated,
        ancestor: m?.ancestorText ?? null,
        ancestorIds: m?.ancestorIds ?? [],
        parentId: m?.parentId ?? null,
        updatedAt: m?.updatedAt ?? null,
        createdAt: m?.createdAt ?? null,
        source: src?.source ?? 'tag-only',
        tagId: src?.tagId ?? '',
      };
    });

    return {
      schemas,
      rows: items.map((x) => ({ id: x.id, tagId: x.tagId, source: x.source })),
      dueCandidate: dueAttrId,
      items,
      totalCandidates: allIds.length,
      totalMatched,
      hasMore,
      nextOffset,
    };
  });

  const suggestions: string[] = [];
  if (result.items && result.items.length > 0) {
    suggestions.push('Read full content: outline_rem_subtree or inspect_rem_doc');
    if (result.hasMore && result.nextOffset != null) {
      suggestions.push(`More results available. Call list_todos again with offset=${result.nextOffset}`);
    }
  } else {
    suggestions.push('No matches. Verify header Tags or adjust tagTitles aliases');
  }

  const schemaSumm = result.schemas.map((s) => `${s.tagName}(${s.tagId})`).join(', ');
  const guidance =
    result.totalMatched > 0
      ? `Identified tags: ${schemaSumm}. Matched ${result.totalMatched}; returning ${result.items.length} (offset=${offset}, limit=${limit}).`
      : tagTitles.length > 0
        ? `No matching tasks found under ${tagTitles.join('/')}.`
        : `No matching tasks found.`;

  const payload: ListTodosPayload = {
    dbPath: info.dbPath,
    resolution: info.source,
    dirName: info.dirName,
    guidance,
    status: (parsed.status ?? 'unfinished') as any,
    limit,
    offset,
    hasMore: result.hasMore,
    nextOffset: result.nextOffset,
    totalCandidates: result.totalCandidates ?? 0,
    totalMatched: result.totalMatched ?? 0,
    usedSchemas: result.schemas,
    items: result.items ?? [],
  };

  return { ...payload, next: suggestions };
}

// -------- Implementation details (reused from read_table_rem/execute_search_query) --------

function discoverTagsByTitle(db: BetterSqliteInstance, titles: string[]): Array<{ id: string; name: string }> {
  if (!titles || titles.length === 0) return [];
  const placeholders = titles.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT _id AS id, doc
         FROM quanta
        WHERE json_extract(doc, '$.key[0]') IN (${placeholders})`,
    )
    .all(...titles) as Array<{ id: string; doc: string }>;
  return rows.map((r) => ({ id: r.id, name: summarizeTitle(safeJsonParse(r.doc)) }));
}

function remExists(db: BetterSqliteInstance, id: string): boolean {
  try {
    const row = db.prepare('SELECT 1 FROM quanta WHERE _id = ? LIMIT 1').get(id) as { 1?: number } | undefined;
    return !!row;
  } catch {
    return false;
  }
}

function summarizeTitle(doc: Record<string, unknown> | null | undefined): string {
  const key = (doc as any)?.key;
  if (!Array.isArray(key) || key.length === 0) return '';
  const first = key[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof (first as any).text === 'string') {
    return (first as any).text;
  }
  return '';
}

function loadProperties(db: BetterSqliteInstance, tagId: string): PropertyContext {
  const stmt = db.prepare(
    `SELECT _id AS id, doc, json_extract(doc, '$.rcrs') AS rawType
       FROM quanta
      WHERE json_extract(doc, '$.parent') = @tagId
        AND json_extract(doc, '$.rcrs') IS NOT NULL
      ORDER BY json_extract(doc, '$.f')`,
  );

  const optionStmt = db.prepare(
    `SELECT _id AS id, doc, json_extract(doc, '$.rcre') AS rawOptionType
       FROM quanta
      WHERE json_extract(doc, '$.parent') = @parent
        AND json_extract(doc, '$.rcre') IS NOT NULL
      ORDER BY json_extract(doc, '$.f')`,
  );

  const properties: PropertyContext['properties'] = [];
  const optionNameById = new Map<string, string>();
  const propertyRows = stmt.all({ tagId }) as Array<{ id: string; doc: string; rawType: unknown }>;

  for (const row of propertyRows) {
    const doc = safeJsonParse<Record<string, unknown>>(row.doc);
    const rawType = typeof row.rawType === 'string' ? row.rawType : null;
    const typeCode = rawType ? (rawType.split('.')[1] ?? null) : null;
    const kind = mapPropertyType(typeCode);
    const name = summarizeTitle(doc);

    const options: Array<{ id: string; name: string; rowIds: Set<string> }> = [];
    const optionRows = optionStmt.all({ parent: row.id }) as Array<{
      id: string;
      doc: string;
      rawOptionType: unknown;
    }>;

    for (const optionRow of optionRows) {
      const optionDoc = safeJsonParse<Record<string, unknown>>(optionRow.doc);
      const optionName = summarizeTitle(optionDoc);
      const pdRaw = optionDoc?.pd;
      const pdObject =
        typeof pdRaw === 'string' ? safeJsonParse<Record<string, unknown>>(pdRaw) : (pdRaw as Record<string, unknown>);
      const rowIds = new Set<string>();
      if (pdObject && typeof pdObject === 'object') {
        for (const key of Object.keys(pdObject)) {
          if (key) rowIds.add(key);
        }
      }
      options.push({ id: optionRow.id, name: optionName, rowIds });
      optionNameById.set(optionRow.id, optionName);
    }

    properties.push({ id: row.id, name, rawType, kind, options });
  }

  return { properties, optionNameById };
}

function mapPropertyType(code: string | null): string {
  if (!code) return 'unknown';
  switch (code) {
    case 's':
      return 'select';
    case 'm':
      return 'multi_select';
    case 't':
      return 'text';
    case 'n':
      return 'number';
    case 'd':
      return 'date';
    case 'c':
      return 'checkbox';
    default:
      return `unknown(${code})`;
  }
}

function loadRows(
  db: BetterSqliteInstance,
  tagId: string,
  options: { limit: number; offset: number },
): { rows: Array<{ id: string; doc: string }>; total: number } {
  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM (
           SELECT q._id
           FROM quanta q
           JOIN json_each(q.doc, '$.tp') jt
             ON 1 = 1
          WHERE jt.key = @tagId
          GROUP BY q._id
         )`,
    )
    .get({ tagId }) as { total: number };

  const rows = db
    .prepare(
      `SELECT q._id AS id, q.doc AS doc
         FROM quanta q
         JOIN json_each(q.doc, '$.tp') jt
           ON 1 = 1
        WHERE jt.key = @tagId
        GROUP BY q._id
        ORDER BY COALESCE(
          CAST(json_extract(q.doc, '$.u') AS INTEGER),
          CAST(json_extract(q.doc, '$.m') AS INTEGER),
          CAST(json_extract(q.doc, '$.createdAt') AS INTEGER),
          0
        ) DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({ tagId, limit: options.limit, offset: options.offset }) as Array<{ id: string; doc: string }>;

  return { rows, total: countRow?.total ?? 0 };
}

function parseEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.floor(value);
    if (n <= 0) return null;
    return n > 10_000_000_000 ? n : n * 1000;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const n = Math.floor(Number(trimmed));
      if (!Number.isFinite(n) || n <= 0) return null;
      return n > 10_000_000_000 ? n : n * 1000;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
    const text = coalesceText((doc as any).kt, (doc as any).ke);
    const ancestor = stringifyAncestor(row.ancestorNotRefText, row.ancestorIds);
    const remDoc = quantaMap.get(row.id);
    const createdAt =
      parseEpochMs((remDoc as any)?.createdAt) ?? parseEpochMs((remDoc as any)?.c) ?? parseEpochMs((remDoc as any)?.m);
    const updatedAt = parseEpochMs((remDoc as any)?.u) ?? parseEpochMs((remDoc as any)?.m) ?? createdAt;
    const parentId = typeof (remDoc as any)?.parent === 'string' ? ((remDoc as any).parent as string) : null;
    result.set(row.id, {
      id: row.id,
      aliasId: row.aliasId,
      text,
      ancestorText: ancestor.text || null,
      ancestorIds: ancestor.ids,
      parentId,
      updatedAt,
      createdAt,
    });
  }
  return result;
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
  const result = new Map<string, number | string | null>();
  const dateCache = new Map<string, number | null>();

  for (const row of rows) {
    if (!row.parentId) continue;
    const parsed = safeJsonParse<Record<string, unknown>>(row.doc);
    if (!parsed) continue;
    const value = extractSortValue(parsed, db, dateCache);
    if (value != null) result.set(row.parentId, value);
  }
  return result;
}

function extractSortValue(
  doc: Record<string, unknown>,
  db: BetterSqliteInstance,
  cache: Map<string, number | null>,
): number | string | null {
  const rawValue: unknown = (doc as any).value;
  const tokens = Array.isArray(rawValue) ? rawValue : rawValue != null ? [rawValue] : [];
  const numbers: number[] = [];
  const strings: string[] = [];
  const refs: string[] = [];

  for (const token of tokens) {
    if (typeof token === 'string') {
      strings.push(token);
      const num = Number(token);
      if (Number.isFinite(num)) numbers.push(num);
      continue;
    }
    if (token && typeof token === 'object') {
      const obj = token as Record<string, unknown>;
      const t = (obj as any).text;
      if (typeof t === 'string') {
        strings.push(t);
        const num = Number(t);
        if (Number.isFinite(num)) numbers.push(num);
        continue;
      }
      if ((obj as any).i === 'q' && typeof (obj as any)._id === 'string') {
        refs.push(String((obj as any)._id));
        continue;
      }
    }
  }

  if (numbers.length > 0) return Math.min(...numbers);
  const dateValues: number[] = [];
  for (const ref of refs) {
    const ts = resolveDateReference(db, ref, cache);
    if (ts != null) dateValues.push(ts);
  }
  if (dateValues.length > 0) return Math.min(...dateValues);
  if (strings.length > 0) return strings[0];
  return null;
}

function compareSortValues(a: unknown, b: unknown): number {
  const aU = a == null;
  const bU = b == null;
  if (aU && bU) return 0;
  if (aU) return 1; // Missing values go last
  if (bU) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  // Prefer numbers over strings
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return 0;
}

function normalizeDateInput(value: string | number): number | null {
  if (typeof value === 'number') return value > 10_000 ? value : value * 1000;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'today') {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }
  if (lower === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }
  if (lower === 'tomorrow') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }
  if (/^\d{10}$/.test(trimmed)) return Number(trimmed) * 1000;
  if (/^\d{13}$/.test(trimmed)) return Number(trimmed);
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

// When option pd mapping is missing, reverse-lookup rows by property value Rem:
// Condition: key[0]._id = statusAttrId and value array contains { i:'q', _id: optionId }
// Also require the row has the tagId (via row.tp[tagId].t = 1)
function queryRowsByAttributeOption(
  db: BetterSqliteInstance,
  tagId: string,
  statusAttrId: string,
  optionId: string,
): Set<string> {
  try {
    const rows = db
      .prepare(
        `WITH attr AS (
           SELECT json_extract(doc,'$.parent') AS rowId
             FROM quanta, json_each(quanta.doc, '$.value') je
            WHERE json_extract(quanta.doc,'$.key[0]._id') = @statusAttrId
              AND json_type(json_extract(quanta.doc,'$.value')) = 'array'
              AND json_extract(je.value, '$.i') = 'q'
              AND json_extract(je.value, '$._id') = @optionId
         )
         SELECT q._id AS rowId
           FROM quanta q
           JOIN attr a ON q._id = a.rowId
          WHERE json_extract(q.doc, '$.tp."${tagId}".t') = 1`,
      )
      .all({ statusAttrId, optionId }) as Array<{ rowId: string }>;
    return new Set(rows.map((r) => r.rowId).filter(Boolean));
  } catch {
    const rows = db
      .prepare(
        `SELECT json_extract(doc,'$.parent') AS rowId
           FROM quanta
          WHERE json_extract(doc,'$.key[0]._id') = @statusAttrId
            AND doc LIKE @needle`,
      )
      .all({ statusAttrId, needle: `%"_id":"${optionId}"%` }) as Array<{ rowId: string | null }>;
    const ids = rows.map((r) => r.rowId).filter((x): x is string => !!x);
    if (ids.length === 0) return new Set<string>();
    const placeholders = ids.map(() => '?').join(',');
    const filtered = db
      .prepare(
        `SELECT _id AS rowId
           FROM quanta
          WHERE _id IN (${placeholders})
            AND json_extract(doc, '$.tp."${tagId}".t') = 1`,
      )
      .all(...ids) as Array<{ rowId: string }>;
    return new Set(filtered.map((r) => r.rowId));
  }
}

function queryRowsByAttributePresence(db: BetterSqliteInstance, tagId: string, attributeId: string): Set<string> {
  try {
    const rows = db
      .prepare(
        `WITH attr AS (
           SELECT json_extract(doc,'$.parent') AS rowId
             FROM quanta
            WHERE json_extract(doc,'$.key[0]._id') = @attributeId
              AND json_extract(doc,'$.parent') IS NOT NULL
         )
         SELECT q._id AS rowId
           FROM quanta q
           JOIN attr a ON q._id = a.rowId
          WHERE json_extract(q.doc, '$.tp."${tagId}".t') = 1`,
      )
      .all({ attributeId }) as Array<{ rowId: string }>;
    return new Set(rows.map((r) => r.rowId).filter(Boolean));
  } catch {
    const rows = db
      .prepare(
        `SELECT json_extract(doc,'$.parent') AS rowId
           FROM quanta
          WHERE json_extract(doc,'$.key[0]._id') = @attributeId
            AND json_extract(doc,'$.parent') IS NOT NULL`,
      )
      .all({ attributeId }) as Array<{ rowId: string | null }>;
    const ids = rows.map((r) => r.rowId).filter((x): x is string => !!x);
    if (ids.length === 0) return new Set<string>();
    const placeholders = ids.map(() => '?').join(',');
    const filtered = db
      .prepare(
        `SELECT _id AS rowId
           FROM quanta
          WHERE _id IN (${placeholders})
            AND json_extract(doc, '$.tp."${tagId}".t') = 1`,
      )
      .all(...ids) as Array<{ rowId: string }>;
    return new Set(filtered.map((r) => r.rowId));
  }
}

function resolveDateReference(
  db: BetterSqliteInstance,
  remId: string,
  cache: Map<string, number | null>,
): number | null {
  if (cache.has(remId)) return cache.get(remId) ?? null;
  const row = db.prepare('SELECT doc FROM quanta WHERE _id = ?').get(remId) as { doc?: string } | undefined;
  if (!row?.doc) {
    cache.set(remId, null);
    return null;
  }
  const data = safeJsonParse<Record<string, unknown>>(row.doc);
  let result: number | null = null;
  const crt = (data as any)?.crt as Record<string, unknown> | undefined;
  const d = crt?.d as Record<string, unknown> | undefined;
  const seconds = (() => {
    const s = d?.s;
    if (typeof s === 'number') return s;
    if (typeof s === 'string') {
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
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
      if (Number.isFinite(parsed)) result = parsed;
    }
  }
  if (!result && Array.isArray((data as any)?.key)) {
    const keyCandidate = (data as any).key[0];
    if (typeof keyCandidate === 'string') {
      const fromKey = Date.parse(keyCandidate);
      if (Number.isFinite(fromKey)) result = fromKey;
    }
  }
  cache.set(remId, result);
  return result;
}
