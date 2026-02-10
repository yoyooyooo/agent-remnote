import { z, type ZodRawShape } from 'zod';

import {
  safeJsonParse,
  summarizeKey,
  withResolvedDatabase,
  parseOrThrow,
  type BetterSqliteInstance,
} from './shared.js';
import { executeFindRemsByReference } from './findRemsByReference.js';

const inputShape = {
  id: z.string().min(1, 'id is required').describe('Target Rem ID (collect [[references]] within this Rem)'),
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
  includeOccurrences: z
    .boolean()
    .optional()
    .describe('Include per-occurrence details (default false; aggregated only)'),
  resolveText: z.boolean().optional().describe('Resolve referenced Rem text snippets (default true)'),
  includeDescendants: z.boolean().optional().describe('Include descendants in the scan (default false)'),
  maxDepth: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe('Max subtree depth when includeDescendants=true (default 5)'),
  includeInbound: z.boolean().optional().describe('Also include inbound references (default false)'),
  inboundMaxDepth: z.number().int().min(1).max(3).optional().describe('Max inbound reference depth (default 1)'),
  inboundMaxCandidates: z.number().int().min(1).max(1000).optional().describe('Inbound candidate cap (default 200)'),
} satisfies ZodRawShape;

export const listRemReferencesSchema = z.object(inputShape);
export type ListRemReferencesInput = z.infer<typeof listRemReferencesSchema>;

type ReferenceOccurrence = {
  refId: string;
  remId: string;
  path: string;
  tokenKind: string;
};

type AggregatedReference = {
  refId: string;
  count: number;
  text: string | null;
  ancestor: string | null;
  ancestorIds: string[];
  remIds: string[];
  tokenKinds: string[];
  occurrences: Array<{ remId: string; path: string; tokenKind: string }>;
};

type RemDocument = {
  id: string;
  doc?: Record<string, unknown>;
  key: unknown;
  value: unknown;
};

type InboundReference = {
  remId: string;
  title: string | null;
  snippet: string | null;
  matchedTargets: string[];
  anchorIds: string[];
  sourceIds: string[];
  depth: number;
  updatedAt: number | null;
  createdAt: number | null;
  ancestor: string | null;
  ancestorIds: string[];
};

type ListRemReferencesPayload = {
  dbPath: string;
  resolution: string;
  dirName?: string;
  remId: string;
  guidance: string;
  includeDescendants: boolean;
  maxDepth: number;
  remsScanned: number;
  totalOccurrences: number;
  uniqueCount: number;
  markdown: string;
  references: (AggregatedReference | ReturnType<typeof simplifyReference>)[];
  includeInbound: boolean;
  inboundMaxDepth: number;
  inboundMaxCandidates: number;
  inboundCount: number;
  inbound: (InboundReference | ReturnType<typeof simplifyInbound>)[];
};

export async function executeListRemReferences(
  params: ListRemReferencesInput,
): Promise<{ payload: ListRemReferencesPayload; suggestions: string[] }> {
  const parsed = parseOrThrow(listRemReferencesSchema, params, { label: 'list_rem_references' });
  const includeOccurrences = parsed.includeOccurrences ?? false;
  const resolveText = parsed.resolveText ?? true;
  const includeDescendants = parsed.includeDescendants ?? false;
  const maxDepth = parsed.maxDepth ?? 5;
  const includeInbound = parsed.includeInbound ?? false;
  const inboundMaxDepth = parsed.inboundMaxDepth ?? 1;
  const inboundMaxCandidates = parsed.inboundMaxCandidates ?? 200;
  const normalizedInboundCandidates = Math.min(inboundMaxCandidates, 200);

  const { result, info } = await withResolvedDatabase(parsed.dbPath, async (db) => {
    const docs = fetchDocs(db, parsed.id, includeDescendants, maxDepth);
    const occurrences: ReferenceOccurrence[] = [];

    for (const doc of docs) {
      collectReferences(doc.key, doc.id, ['key'], occurrences);
      if (doc.value !== undefined) {
        collectReferences(doc.value, doc.id, ['value'], occurrences);
      }
    }

    const aggregate = aggregateReferences(occurrences);

    if (resolveText && aggregate.size > 0) {
      enrichReferenceDetails(db, aggregate);
    }

    const references = Array.from(aggregate.values()).sort((a, b) => b.count - a.count);

    let inbound: InboundReference[] = [];
    if (includeInbound) {
      const inboundResult = await executeFindRemsByReference({
        targetIds: docs.map((doc) => doc.id),
        maxDepth: inboundMaxDepth,
        maxCandidates: normalizedInboundCandidates,
        limit: normalizedInboundCandidates,
        offset: 0,
        dbPath: parsed.dbPath,
      });

      inbound = inboundResult.matches.map((match) => ({
        remId: match.id,
        title: match.title ?? null,
        snippet: match.snippet ?? null,
        matchedTargets: match.matchedTargets ?? [],
        anchorIds: match.anchorIds ?? [],
        sourceIds: match.sourceIds ?? [],
        depth: match.depth ?? inboundMaxDepth,
        updatedAt: match.updatedAt ?? null,
        createdAt: match.createdAt ?? null,
        ancestor: null,
        ancestorIds: [],
      }));

      enrichInboundDetails(db, inbound);
    }

    return {
      remsScanned: docs.length,
      references,
      totalOccurrences: occurrences.length,
      uniqueCount: references.length,
      includeDescendants,
      inbound,
      inboundCount: inbound.length,
    };
  });

  const guidance =
    result.uniqueCount > 0
      ? `Found ${result.uniqueCount} unique references (${result.totalOccurrences} occurrences).`
      : 'No references found in this Rem.';

  const originalOutbound = result.references;
  const markdown = buildReferencesMarkdown(
    params.id,
    guidance,
    originalOutbound.map((item) => simplifyReference(item)),
    result.inbound ?? [],
    includeInbound,
  );

  const outboundForResponse = includeOccurrences
    ? originalOutbound
    : originalOutbound.map((item) => simplifyReference(item));

  const inboundForResponse = includeInbound ? (result.inbound?.map((item) => simplifyInbound(item)) ?? []) : [];

  const payload: ListRemReferencesPayload = {
    dbPath: info.dbPath,
    resolution: info.source,
    dirName: info.dirName,
    remId: params.id,
    guidance,
    includeDescendants,
    maxDepth,
    remsScanned: result.remsScanned,
    totalOccurrences: result.totalOccurrences,
    uniqueCount: result.uniqueCount,
    markdown,
    references: outboundForResponse,
    includeInbound,
    inboundMaxDepth,
    inboundMaxCandidates: normalizedInboundCandidates,
    inboundCount: result.inboundCount ?? 0,
    inbound: inboundForResponse,
  };

  const suggestions =
    result.uniqueCount > 0
      ? [
          'To expand a referenced Rem, call outline_rem_subtree id=<refId>',
          'To view context, call outline_rem_subtree id=<remId> includeEmpty=true',
        ]
      : ['No references detected; verify this Rem is not plain text-only'];

  if (!includeDescendants) {
    suggestions.push('To include descendants, set includeDescendants=true');
  }
  if (!includeInbound) {
    suggestions.push('To include inbound references, set includeInbound=true');
  }

  return { payload, suggestions };
}

function fetchDocs(
  db: BetterSqliteInstance,
  rootId: string,
  includeDescendants: boolean,
  maxDepth: number,
): RemDocument[] {
  const convertRow = (id: string, rawDoc: string): RemDocument => {
    const parsed = safeJsonParse<Record<string, unknown>>(rawDoc);
    return {
      id,
      doc: parsed ?? undefined,
      key: parsed?.key,
      value: parsed?.value,
    };
  };

  if (!includeDescendants) {
    const row = db.prepare('SELECT doc FROM quanta WHERE _id = ?').get(rootId) as { doc: string } | undefined;
    if (!row) {
      throw new Error(`Rem not found (id=${rootId}). Verify the ID exists in the current database.`);
    }
    return [convertRow(rootId, row.doc)];
  }

  const rows = db
    .prepare(
      `WITH RECURSIVE tree(id, depth) AS (
        SELECT _id, 0 FROM quanta WHERE _id = @root
        UNION ALL
        SELECT child._id, tree.depth + 1
        FROM quanta child
        JOIN tree ON json_extract(child.doc, '$.parent') = tree.id
        WHERE tree.depth + 1 <= @maxDepth
      )
      SELECT tree.id, quanta.doc
      FROM tree
      JOIN quanta ON quanta._id = tree.id`,
    )
    .all({ root: rootId, maxDepth }) as Array<{ id: string; doc: string }>;

  if (rows.length === 0) {
    throw new Error(`Rem not found (id=${rootId}). Verify the ID exists in the current database.`);
  }

  return rows.map((row) => convertRow(row.id, row.doc));
}

function collectReferences(value: unknown, remId: string, path: (string | number)[], into: ReferenceOccurrence[]) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectReferences(item, remId, [...path, index], into);
    });
    return;
  }

  if (value && typeof value === 'object') {
    const maybeRef = value as Record<string, unknown>;
    if (maybeRef.i === 'q' && typeof maybeRef._id === 'string') {
      into.push({
        refId: maybeRef._id,
        remId,
        path: formatPath(path),
        tokenKind: classifyToken(maybeRef),
      });
      return;
    }
    if (maybeRef.i === 'p' && typeof maybeRef._id === 'string') {
      into.push({
        refId: maybeRef._id,
        remId,
        path: formatPath(path),
        tokenKind: classifyToken(maybeRef),
      });
      return;
    }

    for (const [key, child] of Object.entries(maybeRef)) {
      collectReferences(child, remId, [...path, key], into);
    }
  }
}

function formatPath(segments: (string | number)[]): string {
  return segments
    .map((segment, index) => {
      if (typeof segment === 'number') {
        return `[${segment}]`;
      }
      return index === 0 ? segment : `.${segment}`;
    })
    .join('');
}

function aggregateReferences(occurrences: ReferenceOccurrence[]): Map<string, AggregatedReference> {
  const map = new Map<string, AggregatedReference>();
  for (const occurrence of occurrences) {
    const existing = map.get(occurrence.refId);
    if (existing) {
      existing.count += 1;
      existing.occurrences.push({
        remId: occurrence.remId,
        path: occurrence.path,
        tokenKind: occurrence.tokenKind,
      });
      if (!existing.remIds.includes(occurrence.remId)) {
        existing.remIds.push(occurrence.remId);
      }
      if (!existing.tokenKinds.includes(occurrence.tokenKind)) {
        existing.tokenKinds.push(occurrence.tokenKind);
      }
    } else {
      map.set(occurrence.refId, {
        refId: occurrence.refId,
        count: 1,
        text: null,
        ancestor: null,
        ancestorIds: [],
        remIds: [occurrence.remId],
        tokenKinds: [occurrence.tokenKind],
        occurrences: [
          {
            remId: occurrence.remId,
            path: occurrence.path,
            tokenKind: occurrence.tokenKind,
          },
        ],
      });
    }
  }
  return map;
}

function enrichReferenceDetails(db: BetterSqliteInstance, aggregate: Map<string, AggregatedReference>) {
  if (aggregate.size === 0) return;

  const infoStmt = db.prepare(
    `SELECT
      json_extract(doc, '$.kt') AS plainText,
      ancestor_not_ref_text AS ancestorText,
      ancestor_ids AS ancestorIds
    FROM remsSearchInfos
    WHERE id = ?`,
  );

  const fallbackStmt = db.prepare('SELECT doc FROM quanta WHERE _id = ?');

  for (const entry of aggregate.values()) {
    const infoRow = infoStmt.get(entry.refId) as
      | {
          plainText: string | null;
          ancestorText: string | null;
          ancestorIds: string | null;
        }
      | undefined;

    if (infoRow) {
      entry.text = normalizeSnippet(infoRow.plainText);
      entry.ancestor = infoRow.ancestorText ? infoRow.ancestorText.trim() : null;
      entry.ancestorIds = infoRow.ancestorIds ? infoRow.ancestorIds.trim().split(/\s+/).filter(Boolean) : [];
    } else {
      const fallback = fallbackStmt.get(entry.refId) as { doc: string } | undefined;
      if (fallback) {
        const parsed = safeJsonParse<Record<string, unknown>>(fallback.doc);
        const summary = summarizeKey(parsed?.key, undefined, { expand: false, maxDepth: 0 });
        entry.text = normalizeSnippet(summary.text);
      }
    }
  }
}

function normalizeSnippet(text: string | null | undefined): string | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function simplifyReference(item: AggregatedReference) {
  return {
    refId: item.refId,
    text: item.text,
    count: item.count,
    ancestor: item.ancestor,
    remIds: item.remIds,
    tokenKinds: item.tokenKinds,
    representativePath: item.occurrences[0]?.path ?? null,
  };
}

function simplifyInbound(item: InboundReference) {
  return {
    remId: item.remId,
    title: item.title,
    snippet: item.snippet,
    depth: item.depth,
    ancestor: item.ancestor,
    matchedTargetsCount: item.matchedTargets.length,
  };
}

function buildReferencesMarkdown(
  remId: string,
  guidance: string,
  outbound: (AggregatedReference | ReturnType<typeof simplifyReference>)[],
  inbound: InboundReference[],
  includeInbound: boolean,
) {
  const lines: string[] = [];
  lines.push(`# Rem ${remId} Reference Overview`);
  lines.push(guidance);

  lines.push('\n## Outbound References');
  if (outbound.length === 0) {
    lines.push('- No outbound references');
  } else {
    outbound.forEach((ref) => {
      const name = ref.text?.trim() ? ref.text.trim() : '(Untitled)';
      const tokenKind = Array.isArray(ref.tokenKinds) ? `type: ${formatTokenKinds(ref.tokenKinds)}` : '';
      const ancestor = ref.ancestor ? `, ancestor: ${ref.ancestor}` : '';
      const count = typeof ref.count === 'number' ? `${ref.count} occurrences` : '';
      const path = (ref as AggregatedReference).occurrences
        ? ((ref as AggregatedReference).occurrences[0]?.path ?? null)
        : (ref as ReturnType<typeof simplifyReference>).representativePath;
      const samplePath = path ? `, sample path: ${path}` : '';
      lines.push(
        `- **${name}** (ID: ${ref.refId}, ${count}${ancestor}${samplePath}${tokenKind ? `, ${tokenKind}` : ''})`,
      );
    });
  }

  if (includeInbound) {
    lines.push('\n## Inbound References');
    if (inbound.length === 0) {
      lines.push('- No inbound references');
    } else {
      inbound.forEach((ref) => {
        const name = ref.title?.trim() ? ref.title.trim() : '(Untitled)';
        const count = ref.matchedTargets.length > 0 ? `${ref.matchedTargets.length} targets` : '';
        const breadcrumbs = ref.ancestor ? `, in: ${ref.ancestor}` : '';
        lines.push(`- **${name}** (ID: ${ref.remId}, ${count}${breadcrumbs})`);
      });
    }
  }

  return lines.join('\n');
}

function enrichInboundDetails(db: BetterSqliteInstance, inbound: InboundReference[]) {
  if (inbound.length === 0) return;

  const infoStmt = db.prepare(
    `SELECT
      json_extract(doc, '$.kt') AS plainText,
      ancestor_not_ref_text AS ancestorText,
      ancestor_ids AS ancestorIds
    FROM remsSearchInfos
    WHERE id = ?`,
  );

  const fallbackStmt = db.prepare('SELECT doc FROM quanta WHERE _id = ?');

  for (const entry of inbound) {
    const infoRow = infoStmt.get(entry.remId) as
      | {
          plainText: string | null;
          ancestorText: string | null;
          ancestorIds: string | null;
        }
      | undefined;

    if (infoRow) {
      const snippet = normalizeSnippet(infoRow.plainText);
      if (!entry.title || entry.title === '(empty)') {
        entry.title = snippet ?? entry.title;
      }
      entry.snippet = entry.snippet && entry.snippet.trim().length > 0 ? entry.snippet : snippet;
      entry.ancestor = infoRow.ancestorText ? infoRow.ancestorText.trim() : null;
      entry.ancestorIds = infoRow.ancestorIds ? infoRow.ancestorIds.trim().split(/\s+/).filter(Boolean) : [];
    } else {
      const fallback = fallbackStmt.get(entry.remId) as { doc: string } | undefined;
      if (fallback) {
        const parsed = safeJsonParse<Record<string, unknown>>(fallback.doc);
        const summary = summarizeKey(parsed?.key, undefined, { expand: false, maxDepth: 0 });
        const snippet = normalizeSnippet(summary.text);
        if (!entry.title || entry.title === '(empty)') {
          entry.title = snippet ?? entry.title;
        }
        entry.snippet = entry.snippet && entry.snippet.trim().length > 0 ? entry.snippet : snippet;
      }
    }
  }
}

function classifyToken(token: Record<string, unknown>): string {
  const raw = typeof token.i === 'string' ? token.i : '';
  const tokenMap: Record<string, string> = {
    q: 'reference',
    p: 'portal',
    u: 'url',
    m: 'text',
    t: 'tag',
    r: 'rich_text',
  };
  return tokenMap[raw] ?? (raw || 'unknown');
}

function formatTokenKinds(kinds: string[]) {
  const unique = Array.from(new Set(kinds));
  return unique.join('/');
}
