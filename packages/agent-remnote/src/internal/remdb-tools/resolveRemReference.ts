import { z, type ZodRawShape } from 'zod';

import { summarizeKey, safeJsonParse, withResolvedDatabase, parseOrThrow } from './shared.js';

const inputShape = {
  ids: z
    .array(z.string().min(1))
    .min(1, 'ids is required (at least 1)')
    .describe('List of referenced Rem IDs to resolve'),
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
  expandReferences: z.boolean().optional().describe('Expand reference chain text (default true)'),
  maxReferenceDepth: z.number().int().min(0).max(5).optional().describe('Max reference expansion depth (default 1)'),
  detail: z.boolean().optional().describe('Include raw key/doc details'),
} satisfies ZodRawShape;

export const resolveRemReferenceSchema = z.object(inputShape);
export type ResolveRemReferenceInput = z.infer<typeof resolveRemReferenceSchema>;

type ResolvedReferenceDetail = {
  id: string;
  found: boolean;
  text: string;
  references: string[];
  rawKey?: unknown;
  rawDoc?: Record<string, unknown> | undefined;
};

export async function executeResolveRemReference(params: ResolveRemReferenceInput) {
  const parsed = parseOrThrow(resolveRemReferenceSchema, params, { label: 'resolve_rem_reference' });
  const expand = parsed.expandReferences ?? true;
  const maxDepth = parsed.maxReferenceDepth ?? 1;
  const detail = parsed.detail ?? false;

  const { result, info } = await withResolvedDatabase(parsed.dbPath, async (db) => {
    const stmt = db.prepare('SELECT doc FROM quanta WHERE _id = ?');
    const referenceTexts = new Map<string, string | null>();
    const referenceSources = new Map<string, Set<string>>();
    const details: ResolvedReferenceDetail[] = parsed.ids.map((id) => {
      const row = stmt.get(id) as { doc: string } | undefined;
      if (!row) {
        referenceTexts.set(id, null);
        return {
          id,
          found: false,
          text: '',
          references: [] as string[],
          rawKey: undefined,
          rawDoc: undefined,
        };
      }
      const doc = safeJsonParse<Record<string, unknown>>(row.doc);
      const keySummary = summarizeKey(doc?.key, db, { expand, maxDepth });
      referenceTexts.set(id, keySummary.text ?? null);
      for (const ref of keySummary.references) {
        if (!referenceSources.has(ref)) {
          referenceSources.set(ref, new Set([id]));
        } else {
          referenceSources.get(ref)!.add(id);
        }
      }
      return {
        id,
        found: true,
        text: keySummary.text,
        references: keySummary.references,
        rawKey: doc?.key,
        rawDoc: doc ?? undefined,
      };
    });
    const nestedTargets: string[] = [];
    for (const refId of referenceSources.keys()) {
      if (!referenceTexts.has(refId)) {
        nestedTargets.push(refId);
      }
    }
    const limit = Math.min(nestedTargets.length, 200);
    for (let index = 0; index < limit; index++) {
      const refId = nestedTargets[index];
      const row = stmt.get(refId) as { doc: string } | undefined;
      if (!row) {
        referenceTexts.set(refId, null);
        continue;
      }
      const doc = safeJsonParse<Record<string, unknown>>(row.doc);
      const summary = summarizeKey(doc?.key, db, { expand: false, maxDepth: 0 });
      referenceTexts.set(refId, summary.text ?? null);
    }

    const referenceTextRecord: Record<string, string | null> = {};
    for (const [id, text] of referenceTexts.entries()) {
      referenceTextRecord[id] = text ?? null;
    }
    const referenceSourceRecord: Record<string, string[]> = {};
    for (const [id, sources] of referenceSources.entries()) {
      referenceSourceRecord[id] = Array.from(sources);
    }

    return { details, referenceTexts: referenceTextRecord, referenceSources: referenceSourceRecord };
  });

  const simplified = detail
    ? result.details
    : result.details.map((item) => ({
        id: item.id,
        found: item.found,
        text: item.text,
        references: item.references,
      }));
  const markdown = buildResolvedMarkdown(result.details);
  const referenceIndex = buildReferenceIndex(result.details, result.referenceTexts, result.referenceSources);

  return {
    dbPath: info.dbPath,
    resolution: info.source,
    dirName: info.dirName,
    count: simplified.length,
    results: simplified,
    markdown,
    referenceIndex,
  };
}

function buildResolvedMarkdown(details: ResolvedReferenceDetail[]) {
  if (!details || details.length === 0) {
    return 'No references were resolved.';
  }
  const lines: string[] = ['# Reference Resolution'];
  for (const item of details) {
    const status = item.found ? '' : ' (not found)';
    lines.push(`- **${item.id}**${status}`);
    if (item.text) {
      lines.push(`  - Text: ${item.text}`);
    }
    if (item.references.length > 0) {
      lines.push(`  - References: ${item.references.join(', ')}`);
    }
    if (!item.found && item.references.length === 0 && !item.text) {
      lines.push('  - No content found');
    }
  }
  return lines.join('\n');
}

function buildReferenceIndex(
  details: ResolvedReferenceDetail[],
  texts: Record<string, string | null>,
  sources: Record<string, string[]>,
) {
  const map: Record<string, { text: string | null; sources: string[] }> = {};

  const ensureEntry = (id: string) => {
    if (!map[id]) {
      map[id] = {
        text: texts[id] ?? null,
        sources: Array.from(new Set(sources[id] ?? [])),
      };
    } else {
      map[id].text ??= texts[id] ?? null;
      const merged = new Set([...(map[id].sources ?? []), ...(sources[id] ?? [])]);
      map[id].sources = Array.from(merged);
    }
  };

  for (const detail of details) {
    ensureEntry(detail.id);
    map[detail.id].text ??= detail.text ?? null;
    for (const ref of detail.references) {
      ensureEntry(ref);
    }
  }

  return map;
}
