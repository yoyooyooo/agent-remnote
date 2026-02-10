import { z, type ZodRawShape } from 'zod';

import { withResolvedDatabase, getDateFormatting, formatDateWithPattern, parseOrThrow } from './shared.js';
import { executeSearchRemOverviewWithDb } from './searchRemOverview.js';
import { executeOutlineRemSubtreeWithDb } from './outlineRemSubtree.js';

const inputShape = {
  days: z.number().int().min(1).max(30).default(7).describe('Summarize the last N days (default 7)'),
  includeEmpty: z.boolean().optional().describe('Include empty lines/empty docs (default false)'),
  includeNotFound: z.boolean().optional().describe('Include dates where no note was found (default false)'),
  expandReferences: z.boolean().optional().describe('Expand [[references]] text (default true)'),
  maxReferenceDepth: z.number().int().min(0).max(5).optional().describe('Max reference expansion depth (default 1)'),
  maxLines: z.number().int().min(1).max(200).optional().describe('Max lines per outline (default 40)'),
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
  detail: z.boolean().optional().describe('Include per-day node details (default false)'),
} satisfies ZodRawShape;

export const summarizeDailyNotesSchema = z.object(inputShape);
export type SummarizeDailyNotesInput = z.infer<typeof summarizeDailyNotesSchema>;

export async function executeSummarizeDailyNotes(params: SummarizeDailyNotesInput) {
  const parsed = parseOrThrow(summarizeDailyNotesSchema, params, { label: 'summarize_daily_notes' });
  const days = parsed.days;
  const includeEmpty = parsed.includeEmpty ?? false;
  const includeNotFound = parsed.includeNotFound ?? false;
  const expandReferences = parsed.expandReferences ?? true;
  const maxReferenceDepth = parsed.maxReferenceDepth ?? 1;
  const maxLines = parsed.maxLines ?? 40;
  const detail = parsed.detail ?? false;

  const detailResults: Array<{
    date: string;
    markdown?: string;
    remId?: string;
    error?: string;
    truncated?: boolean;
    lineCount?: number;
    nodes?: OutlineNodeSummary[];
  }> = [];
  const summaries: DailyNoteSummary[] = [];
  const sections: string[] = [];
  const referenceIndex = new Map<string, ReferenceIndexEntry>();

  const { info } = await withResolvedDatabase(parsed.dbPath, async (db) => {
    const format = (await getDateFormatting(db)) ?? 'yyyy/MM/dd';

    for (let offset = 0; offset > -days; offset--) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + offset);
      const dateString = formatDateWithPattern(targetDate, format);

      const sectionLines: string[] = [];

      try {
        const searchResult = await executeSearchRemOverviewWithDb(db, {
          query: dateString,
          limit: 1,
          preferExact: true,
          exactFirstSingle: true,
        });

        if (searchResult.count === 0 || searchResult.matches.length === 0) {
          summaries.push({ date: dateString, status: 'not_found' });
          detailResults.push({ date: dateString });
          if (includeNotFound) {
            sections.push([`- ${dateString}`, '  - No daily note found'].join('\n'));
          }
          continue;
        }

        const remId = searchResult.matches[0]?.id;
        if (!remId) {
          summaries.push({ date: dateString, status: 'error' });
          sectionLines.push(`- ${dateString}`);
          sectionLines.push('  - No valid Rem ID found');
          detailResults.push({
            date: dateString,
            error: 'No valid Rem ID found',
          });
          sections.push(sectionLines.join('\n'));
          continue;
        }

        const outlineResult = await executeOutlineRemSubtreeWithDb(db, {
          id: remId,
          includeEmpty,
          expandReferences,
          maxReferenceDepth,
          startOffset: 0,
          maxNodes: maxLines,
          format: 'markdown',
          detail: true,
        });

        const markdown = outlineResult.markdown ?? `- ${dateString}`;
        const lines = markdown.split('\n');
        const trimmed = lines.slice(0, maxLines).join('\n');
        const truncated = lines.length > maxLines || outlineResult.hasMore;
        const nodes = Array.isArray((outlineResult as { tree?: OutlineNodeSummary[] }).tree)
          ? ((outlineResult as { tree?: OutlineNodeSummary[] }).tree ?? [])
          : [];
        collectReferenceSummaries(referenceIndex, nodes, remId, outlineResult.title ?? remId);

        summaries.push({
          date: dateString,
          status: truncated ? 'truncated' : 'ok',
          remId,
          title: outlineResult.title ?? remId,
          lineCount: lines.length,
        });
        sectionLines.push(trimmed);
        if (truncated) {
          sectionLines.push(
            `  - Content truncated. Call outline_rem_subtree id=${remId} startOffset=${maxLines} to continue.`,
          );
        }

        const detailEntry: {
          date: string;
          markdown: string;
          remId: string;
          truncated: boolean;
          lineCount: number;
          nodes?: OutlineNodeSummary[];
        } = {
          date: dateString,
          remId,
          markdown: trimmed,
          truncated,
          lineCount: lines.length,
        };
        if (detail) {
          detailEntry.nodes = nodes;
        }
        detailResults.push(detailEntry);
      } catch (error) {
        summaries.push({ date: dateString, status: 'error' });
        sectionLines.push(`- ${dateString}`);
        sectionLines.push(`  - Failed to read: ${String(error)}`);
        detailResults.push({
          date: dateString,
          error: String(error),
        });
      }

      if (sectionLines.length > 0) {
        sections.push(sectionLines.join('\n'));
      }
    }
  });

  const aggregatedMarkdown = buildAggregateMarkdown(days, sections);
  const response: Record<string, unknown> = {
    dbPath: info.dbPath,
    resolution: info.source,
    dirName: info.dirName,
    days,
    maxLines,
    count: summaries.length,
    markdown: aggregatedMarkdown,
    daysSummary: summaries,
    referenceIndex: convertReferenceIndex(referenceIndex),
  };
  if (detail) {
    Object.assign(response, { results: detailResults });
  }
  return response;
}

type OutlineNodeSummary = {
  id: string;
  depth: number;
  text: string;
  references: string[];
};

type DailyNoteSummary = {
  date: string;
  status: 'ok' | 'truncated' | 'not_found' | 'error';
  remId?: string;
  title?: string | null;
  lineCount?: number;
};

type ReferenceIndexEntry = {
  id: string;
  totalOccurrences: number;
  samples: ReferenceOccurrenceSample[];
};

type ReferenceOccurrenceSample = {
  remId: string;
  remTitle: string | null;
  nodeId: string;
  text: string;
  depth: number;
};

function buildAggregateMarkdown(days: number, sections: string[]) {
  const header = `# Daily Notes (last ${days} days)`;
  if (sections.length === 0) {
    return `${header}\n\n- No daily notes found`;
  }
  return [header, ...sections].join('\n\n');
}

function collectReferenceSummaries(
  index: Map<string, ReferenceIndexEntry>,
  nodes: OutlineNodeSummary[],
  remId: string,
  remTitle: string | null,
) {
  if (!nodes || nodes.length === 0) return;
  for (const node of nodes) {
    if (!node.references || node.references.length === 0) continue;
    for (const refId of node.references) {
      if (!refId) continue;
      const entry = ensureReferenceEntry(index, refId);
      entry.totalOccurrences += 1;
      if (entry.samples.length < 5) {
        entry.samples.push({
          remId,
          remTitle,
          nodeId: node.id,
          text: node.text,
          depth: node.depth,
        });
      }
    }
  }
}

function ensureReferenceEntry(index: Map<string, ReferenceIndexEntry>, id: string): ReferenceIndexEntry {
  let entry = index.get(id);
  if (!entry) {
    entry = {
      id,
      totalOccurrences: 0,
      samples: [],
    };
    index.set(id, entry);
  }
  return entry;
}

function convertReferenceIndex(index: Map<string, ReferenceIndexEntry>) {
  const result: Record<string, { totalOccurrences: number; samples: ReferenceOccurrenceSample[] }> = {};
  for (const [id, entry] of index.entries()) {
    result[id] = {
      totalOccurrences: entry.totalOccurrences,
      samples: entry.samples,
    };
  }
  return result;
}
