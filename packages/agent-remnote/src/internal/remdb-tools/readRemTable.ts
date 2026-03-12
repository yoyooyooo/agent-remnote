import { z, type ZodRawShape } from 'zod';

import {
  summarizeKey,
  safeJsonParse,
  withResolvedDatabase,
  parseOrThrow,
  type BetterSqliteInstance,
} from './shared.js';

const inputShape = {
  tagId: z.string().min(1, 'tagId is required').describe('Table tag Rem ID (header tag)'),
  limit: z.number().int().min(1).max(200).optional().describe('Max rows to return per call (default 50)'),
  offset: z.number().int().min(0).optional().describe('Pagination offset (default 0)'),
  includeOptions: z.boolean().optional().describe('Include all options and counts for each property (default false)'),
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
} satisfies ZodRawShape;

export const readRemTableSchema = z.object(inputShape);
export type ReadRemTableInput = z.infer<typeof readRemTableSchema>;

export async function executeReadRemTable(params: ReadRemTableInput) {
  const parsed = parseOrThrow(readRemTableSchema, params, { label: 'read_table_rem' });
  const limit = parsed.limit ?? 50;
  const offset = parsed.offset ?? 0;
  const includeOptions = parsed.includeOptions ?? false;

  const { result, info } = await withResolvedDatabase(parsed.dbPath, async (db) => {
    const tagRow = db.prepare('SELECT doc FROM quanta WHERE _id = ?').get(parsed.tagId) as { doc: string } | undefined;
    if (!tagRow) {
      throw new Error(`Table tag Rem not found (tagId=${parsed.tagId}). Verify the ID is correct.`);
    }

    const tagDoc = safeJsonParse<Record<string, unknown>>(tagRow.doc);
    const tagName = summarizeKey(tagDoc?.key, db, { expand: false, maxDepth: 0 }).text || parsed.tagId;

    const propertyContext = loadProperties(db, parsed.tagId);
    const rowContext = loadRows(db, parsed.tagId, { limit, offset });

    const rowIds = rowContext.rows.map((r) => r.id);

    const propertiesById = new Map<string, { name: string; kind: string }>();
    for (const p of propertyContext.properties) {
      propertiesById.set(p.id, { name: p.name, kind: p.kind });
    }

    const { cellsByRowId, dailyInfoById } = loadCellsForRows(db, rowIds, {
      optionNameById: propertyContext.optionNameById,
      propertiesById,
    });

    const rows = rowContext.rows.map((row) => {
      const rowDoc = safeJsonParse<Record<string, unknown>>(row.doc);
      const summary = summarizeKey(rowDoc?.key, db, { expand: false, maxDepth: 0 });
      const cells = cellsByRowId.get(row.id) ?? {};

      // Back-compat: keep `options` as a select/multi_select-only view.
      const options: Record<string, { optionIds: string[]; optionNames: string[] }> = {};
      for (const [propertyId, cell] of Object.entries(cells)) {
        const kind = String((cell as any)?.kind ?? '');
        if (kind !== 'select' && kind !== 'multi_select') continue;
        const optionIds = Array.isArray((cell as any)?.optionIds) ? ((cell as any).optionIds as string[]) : [];
        const optionNames = Array.isArray((cell as any)?.optionNames) ? ((cell as any).optionNames as string[]) : [];
        options[propertyId] = { optionIds, optionNames };
      }

      return {
        id: row.id,
        title: summary.text || '',
        cells,
        options,
      };
    });

    const hasMore = offset + rows.length < rowContext.total;

    const properties = propertyContext.properties.map((property) => ({
      id: property.id,
      name: property.name,
      rawType: property.rawType,
      kind: property.kind,
      optionCount: property.options.length,
      options: includeOptions
        ? property.options.map((option) => ({
            id: option.id,
            name: option.name,
            rowCount: option.rowIds.size,
          }))
        : undefined,
    }));

    return {
      tagId: parsed.tagId,
      tagName,
      properties,
      propertyCount: properties.length,
      rows,
      rowCount: rows.length,
      totalRows: rowContext.total,
      offset,
      limit,
      hasMore,
      nextOffset: hasMore ? offset + rows.length : null,
      dailyDocs: dailyInfoById.size > 0 ? Object.fromEntries(dailyInfoById.entries()) : undefined,
    };
  });

  const suggestions: string[] = [];
  suggestions.push('To view a row outline, call outline_rem_subtree with id=<rowId>');
  if (result.hasMore && result.nextOffset != null) {
    suggestions.unshift(`More rows available. Call read_table_rem again with offset=${result.nextOffset}`);
  }
  if (result.properties.length === 0) {
    suggestions.push(
      'No table properties detected. Verify tagId is a table tag or check whether this is a Powerup table.',
    );
  }

  const guidance = `Parsed table for tag "${result.tagName}". Returned ${result.rowCount} rows (total ${result.totalRows}).`;

  return {
    guidance,
    ...result,
    dbPath: info.dbPath,
    resolution: info.source,
    dirName: info.dirName,
    next: suggestions,
  };
}

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

type RowContext = {
  rows: Array<{ id: string; doc: string }>;
  total: number;
};

type CellValue = {
  readonly kind: string;
  readonly propertyId: string;
  readonly propertyName: string;
  readonly text?: string;
  readonly references?: readonly string[];
  readonly optionIds?: readonly string[];
  readonly optionNames?: readonly string[];
  readonly checked?: boolean | null;
  readonly number?: number | null;
  readonly numberText?: string | null;
  readonly dailyId?: string | null;
  readonly dateString?: string | null;
  readonly timestamp?: number | null;
};

type CellLoaderContext = {
  readonly optionNameById: Map<string, string>;
  readonly propertiesById: Map<string, { name: string; kind: string }>;
};

function uniqStrings(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (out.includes(v)) continue;
    out.push(v);
  }
  return out;
}

function extractQTokenIds(tokens: unknown): readonly string[] {
  if (!Array.isArray(tokens)) return [];
  const out: string[] = [];
  for (const t of tokens) {
    if (!t || typeof t !== 'object') continue;
    const anyT = t as any;
    if (anyT.i === 'q' && typeof anyT._id === 'string' && anyT._id.trim()) {
      out.push(String(anyT._id));
    }
  }
  return out;
}

function parseCheckbox(text: string): boolean | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  if (s === 'yes' || s === 'true') return true;
  if (s === 'no' || s === 'false') return false;
  return null;
}

function parseNumber(text: string): { readonly number: number | null; readonly numberText: string | null } {
  const s = text.trim();
  if (!s) return { number: null, numberText: null };
  const n = Number(s);
  return Number.isFinite(n) ? { number: n, numberText: s } : { number: null, numberText: s };
}

function loadDailyInfo(db: BetterSqliteInstance, ids: readonly string[]) {
  const out = new Map<string, { timestamp: number | null; dateString: string | null }>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT _id AS id, doc FROM quanta WHERE _id IN (${placeholders})`).all(...ids) as Array<{
    id: string;
    doc: string;
  }>;
  for (const row of rows) {
    const doc = safeJsonParse<Record<string, unknown>>(row.doc) ?? {};
    const crt = (doc as any).crt;
    const d = crt && typeof crt === 'object' ? (crt as any).d : null;
    const timestamp = d && typeof d === 'object' && typeof (d as any).s === 'number' ? ((d as any).s as number) : null;
    const dateString = d && typeof d === 'object' && typeof (d as any).d === 'string' ? ((d as any).d as string) : null;
    out.set(row.id, { timestamp, dateString });
  }
  return out;
}

function loadCellsForRows(
  db: BetterSqliteInstance,
  rowIds: readonly string[],
  ctx: CellLoaderContext,
): {
  readonly cellsByRowId: Map<string, Record<string, CellValue>>;
  readonly dailyInfoById: Map<string, { timestamp: number | null; dateString: string | null }>;
} {
  const cellsByRowId = new Map<string, Record<string, CellValue>>();
  const dailyIds: string[] = [];

  if (rowIds.length === 0) {
    return { cellsByRowId, dailyInfoById: new Map() };
  }

  const placeholders = rowIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT _id AS id,
              doc,
              json_extract(doc, '$.parent') AS parentId
         FROM quanta
        WHERE json_extract(doc, '$.parent') IN (${placeholders})
       `,
    )
    .all(...rowIds) as Array<{ id: string; doc: string; parentId: string }>;

  for (const row of rows) {
    const doc = safeJsonParse<Record<string, unknown>>(row.doc) ?? {};
    const parentId = typeof row.parentId === 'string' ? row.parentId : '';
    if (!parentId) continue;

    const key = (doc as any).key;
    const first = Array.isArray(key) ? key[0] : null;
    const propertyId =
      first && typeof first === 'object' && (first as any).i === 'q' && typeof (first as any)._id === 'string'
        ? String((first as any)._id)
        : '';
    if (!propertyId) continue;

    const prop = ctx.propertiesById.get(propertyId);
    const kind = String(prop?.kind ?? 'unknown');
    const propertyName = String(prop?.name ?? propertyId);

    const valueTokens = (doc as any).value;
    const summary = summarizeKey(valueTokens, db, { expand: false, maxDepth: 0 });

    const cell: CellValue = {
      kind,
      propertyId,
      propertyName,
      text: summary.text || undefined,
      references: summary.references.length > 0 ? summary.references : undefined,
    };

    if (kind === 'select' || kind === 'multi_select') {
      const optionIds = uniqStrings(extractQTokenIds(valueTokens));
      const optionNames = optionIds.map((id) => ctx.optionNameById.get(id) ?? id).filter(Boolean);
      (cell as any).optionIds = optionIds;
      (cell as any).optionNames = optionNames;
    } else if (kind === 'checkbox') {
      (cell as any).checked = cell.text ? parseCheckbox(cell.text) : null;
    } else if (kind === 'number') {
      const parsed = parseNumber(cell.text ?? '');
      (cell as any).number = parsed.number;
      (cell as any).numberText = parsed.numberText;
    } else if (kind === 'date') {
      const ids = extractQTokenIds(valueTokens);
      const dailyId = ids.length > 0 ? ids[0]! : null;
      (cell as any).dailyId = dailyId;
      if (dailyId && !dailyIds.includes(dailyId)) dailyIds.push(dailyId);
    }

    if (!cellsByRowId.has(parentId)) cellsByRowId.set(parentId, {});
    const cells = cellsByRowId.get(parentId)!;
    cells[propertyId] = cell;
  }

  const dailyInfoById = dailyIds.length > 0 ? loadDailyInfo(db, dailyIds) : new Map();
  for (const cells of cellsByRowId.values()) {
    for (const c of Object.values(cells)) {
      const kind = String((c as any)?.kind ?? '');
      if (kind !== 'date') continue;
      const dailyId = (c as any).dailyId ? String((c as any).dailyId) : '';
      if (!dailyId) continue;
      const info = dailyInfoById.get(dailyId);
      (c as any).dateString = info?.dateString ?? null;
      (c as any).timestamp = info?.timestamp ?? null;
    }
  }

  return { cellsByRowId, dailyInfoById };
}

function loadProperties(db: BetterSqliteInstance, tagId: string): PropertyContext {
  const propertyMarkerIds = loadPropertyMarkerIds(db);
  const stmt = db.prepare(
    `SELECT _id AS id,
            doc,
            json_extract(doc, '$.rcrs') AS rawType
       FROM quanta
      WHERE json_extract(doc, '$.parent') = @tagId
      ORDER BY json_extract(doc, '$.f')`,
  );

  const optionStmt = db.prepare(
    `SELECT _id AS id,
            doc,
            json_extract(doc, '$.rcre') AS rawOptionType
       FROM quanta
      WHERE json_extract(doc, '$.parent') = @parent
      ORDER BY json_extract(doc, '$.f')`,
  );

  const properties: PropertyContext['properties'] = [];
  const optionNameById = new Map<string, string>();

  const propertyRows = stmt.all({ tagId }) as Array<{ id: string; doc: string; rawType: unknown }>;

  for (const row of propertyRows) {
    const doc = safeJsonParse<Record<string, unknown>>(row.doc);
    if (!isPropertyDoc(doc, propertyMarkerIds) && typeof row.rawType !== 'string') {
      continue;
    }
    const rawType = typeof row.rawType === 'string' ? row.rawType : null;
    const typeCode = rawType ? (rawType.split('.')[1] ?? null) : null;
    const summary = summarizeKey(doc?.key, db, { expand: false, maxDepth: 0 });

    const options: Array<{ id: string; name: string; rowIds: Set<string> }> = [];
    const optionRows = optionStmt.all({ parent: row.id }) as Array<{
      id: string;
      doc: string;
      rawOptionType: unknown;
    }>;

    for (const optionRow of optionRows) {
      const optionDoc = safeJsonParse<Record<string, unknown>>(optionRow.doc);
      if (!optionDoc || typeof optionDoc !== 'object') continue;
      const optionSummary = summarizeKey(optionDoc?.key, db, { expand: false, maxDepth: 0 });
      const pdRaw = optionDoc?.pd;
      const pdObject =
        typeof pdRaw === 'string' ? safeJsonParse<Record<string, unknown>>(pdRaw) : (pdRaw as Record<string, unknown>);
      const rowIds = new Set<string>();
      if (pdObject && typeof pdObject === 'object') {
        for (const key of Object.keys(pdObject)) {
          if (key) {
            rowIds.add(key);
          }
        }
      }

      options.push({
        id: optionRow.id,
        name: optionSummary.text || optionRow.id,
        rowIds,
      });
      optionNameById.set(optionRow.id, optionSummary.text || optionRow.id);
    }

    const kind = inferPropertyKind({ typeCode, options });

    properties.push({
      id: row.id,
      name: summary.text || row.id,
      rawType,
      kind,
      options,
    });
  }

  return {
    properties,
    optionNameById,
  };
}

function loadPropertyMarkerIds(db: BetterSqliteInstance): Set<string> {
  const rows = db
    .prepare(
      `SELECT _id AS id
         FROM quanta
        WHERE json_extract(doc, '$.rcrt') = 'y'`,
    )
    .all() as Array<{ id: string }>;
  return new Set(rows.map((row) => String(row.id ?? '')).filter(Boolean));
}

function isPropertyDoc(doc: Record<string, unknown> | null, propertyMarkerIds: ReadonlySet<string>): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const tp = (doc as any).tp;
  if (!tp || typeof tp !== 'object' || Array.isArray(tp)) return false;

  for (const markerId of propertyMarkerIds) {
    const value = (tp as Record<string, unknown>)[markerId];
    if (!value || typeof value !== 'object') continue;
    if ((value as any).t === true) return true;
  }

  return false;
}

function inferPropertyKind(params: {
  readonly typeCode: string | null;
  readonly options: readonly { id: string; name: string; rowIds: Set<string> }[];
}): string {
  if (params.typeCode) return mapPropertyType(params.typeCode);
  if (params.options.length > 0) return 'select';
  return 'text';
}

function loadRows(db: BetterSqliteInstance, tagId: string, options: { limit: number; offset: number }): RowContext {
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
      `SELECT q._id AS id,
              q.doc AS doc
         FROM quanta q
         JOIN json_each(q.doc, '$.tp') jt
           ON 1 = 1
        WHERE jt.key = @tagId
        GROUP BY q._id
        ORDER BY COALESCE(json_extract(q.doc, '$.u'), json_extract(q.doc, '$.createdAt'), 0) DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({ tagId, limit: options.limit, offset: options.offset }) as Array<{
    id: string;
    doc: string;
  }>;

  return {
    rows,
    total: countRow?.total ?? 0,
  };
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
