import { z, type ZodRawShape } from 'zod';

import { summarizeKey, safeJsonParse, withResolvedDatabase, parseOrThrow } from './shared.js';

const inputShape = {
  id: z.string().min(1, 'id is required').describe('Target Rem ID'),
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
  expandReferences: z.boolean().optional().describe('Expand referenced text (summary only; default false)'),
  maxReferenceDepth: z.number().int().min(0).max(5).optional().describe('Max reference expansion depth (default 1)'),
} satisfies ZodRawShape;

export const inspectRemDocSchema = z.object(inputShape);
export type InspectRemDocInput = z.infer<typeof inspectRemDocSchema>;

export async function executeInspectRemDoc(params: InspectRemDocInput) {
  const parsed = parseOrThrow(inspectRemDocSchema, params, { label: 'inspect_rem_doc' });
  const expand = parsed.expandReferences ?? false;
  const maxDepth = parsed.maxReferenceDepth ?? 1;

  const { result, info } = await withResolvedDatabase(parsed.dbPath, async (db) => {
    const row = db.prepare('SELECT doc FROM quanta WHERE _id = ?').get(parsed.id) as { doc: string } | undefined;

    if (!row) {
      throw new Error(`Rem not found (id=${parsed.id}). Verify the ID exists in the current database.`);
    }

    const doc = safeJsonParse<Record<string, unknown>>(row.doc);
    const keySummary = summarizeKey(doc?.key, db, { expand, maxDepth });

    return {
      id: parsed.id,
      doc,
      summary: {
        text: keySummary.text,
        references: keySummary.references,
      },
    };
  });

  return {
    dbPath: info.dbPath,
    resolution: info.source,
    dirName: info.dirName,
    ...result,
  };
}
