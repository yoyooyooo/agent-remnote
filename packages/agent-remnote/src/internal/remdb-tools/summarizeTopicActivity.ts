import { z, type ZodRawShape } from 'zod';

import { parseOrThrow } from './shared.js';
import { executeSearchRemOverview } from './searchRemOverview.js';
import { executeOutlineRemSubtree } from './outlineRemSubtree.js';
import { TIME_RANGE_PATTERN, timeValueSchema, resolveTimeFilters, type FilterSummary } from './timeFilters.js';
import { executeFindRemsByReference, type FindRemsByReferenceInput } from './findRemsByReference.js';

type GroupBy = 'none' | 'parent' | 'date';

const inputShape = {
  keywords: z.array(z.string().min(1)).min(1).optional().describe('Keyword list (use either keywords or query)'),
  query: z.string().min(1).optional().describe('Search query string (use either keywords or query)'),
  timeoutMs: z.number().int().min(1).max(30_000).optional().describe('Hard timeout in ms for DB searches (max 30000)'),
  timeRange: z
    .union([
      z.literal('all'),
      z.literal('*'),
      z.string().regex(TIME_RANGE_PATTERN, "timeRange must look like '30d', '2w', '12h'"),
    ])
    .optional()
    .describe('Time range (e.g. 30d/2w/12h or all/*; default 30d)'),
  createdAfter: timeValueSchema.optional().describe('Created time lower bound (ISO/ms/sec)'),
  createdBefore: timeValueSchema.optional().describe('Created time upper bound (ISO/ms/sec)'),
  updatedAfter: timeValueSchema.optional().describe('Updated time lower bound (ISO/ms/sec)'),
  updatedBefore: timeValueSchema.optional().describe('Updated time upper bound (ISO/ms/sec)'),
  maxResults: z.number().int().min(1).max(30).optional().describe('Max aggregated results (default 8)'),
  maxNodesPerResult: z.number().int().min(5).max(200).optional().describe('Max outline nodes per item (default 60)'),
  expandReferences: z.boolean().optional().describe('Expand [[references]] text (default true)'),
  maxReferenceDepth: z.number().int().min(0).max(5).optional().describe('Max reference expansion depth (default 1)'),
  includeEmpty: z.boolean().optional().describe('Include empty nodes (default false)'),
  excludeProperties: z.boolean().optional().describe('Exclude table property/option nodes (default true)'),
  groupBy: z.enum(['none', 'parent', 'date']).optional().describe('Grouping: none/parent/date (default parent)'),
  searchLimit: z
    .number()
    .int()
    .min(5)
    .max(100)
    .optional()
    .describe('Max fetched per search iteration (default 3×maxResults)'),
  mode: z.enum(['auto', 'like', 'fts']).optional().describe('Search mode (default auto)'),
  offset: z.number().int().min(0).optional().describe('Search offset (pagination)'),
  referenceIds: z.array(z.string().min(1)).optional().describe('Optional: Rem IDs used as reference anchors'),
  includeReferenceMatches: z.boolean().optional().describe('Include items matched via references (default true)'),
  referenceDepth: z.number().int().min(1).max(3).optional().describe('Reference search depth (default 1)'),
  maxReferenceCandidates: z
    .number()
    .int()
    .min(1)
    .max(400)
    .optional()
    .describe('Max reference candidates (default 200)'),
  dbPath: z.string().optional().describe('Database file path (default: auto-discover)'),
  detail: z.boolean().optional().describe('Include detailed items/groups structure (default false)'),
} satisfies ZodRawShape;

export const summarizeTopicActivitySchema = z.object(inputShape);
export type SummarizeTopicActivityInput = z.infer<typeof summarizeTopicActivitySchema>;

type MatchSource = 'text' | 'reference';

interface AggregatedMatch {
  id: string;
  title: string | null;
  snippet: string | null;
  ancestor: string | null;
  ancestorIds: string[];
  parentId: string | null;
  matchedBy: Set<MatchSource>;
  matchedTargets: Set<string>;
  anchorIds: Set<string>;
  sourceIds: Set<string>;
  referenceDepth?: number;
  updatedAt?: number | null;
  createdAt?: number | null;
}

interface TopicActivityItem {
  remId: string;
  title: string | null;
  ancestor: string | null;
  ancestorIds: string[];
  parentId: string | null;
  snippet: string | null;
  truncated: boolean;
  matchedBy: MatchSource[];
  matchedTargets?: string[];
  anchorIds?: string[];
  sourceIds?: string[];
  referenceDepth?: number;
  updatedAt?: number | null;
  createdAt?: number | null;
  markdown?: string;
  outlineTitle?: string;
  nodeCount?: number;
  totalNodeCount?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
  error?: string;
  nodes?: OutlineNodeSummary[];
}

interface TopicActivityGroup {
  key: string;
  label: string;
  items: TopicActivityItem[];
}

type OutlineNodeSummary = {
  id: string;
  depth: number;
  text: string;
  references: string[];
};

type TopicActivityHighlight = {
  remId: string;
  title: string | null;
  ancestor: string | null;
  matchedBy: MatchSource[];
  truncated: boolean;
  referenceDepth: number | null;
  anchorIds: string[];
  matchedTargets: string[];
  hasMore: boolean;
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

export type SummarizeTopicActivityResult = {
  dbPath: string;
  resolution: string;
  dirName?: string;
  queryUsed: string;
  keywords: string[];
  groupBy: GroupBy;
  timeRange: string | null;
  filtersApplied: FilterSummary;
  count: number;
  maxResults: number;
  maxNodesPerResult: number;
  totalFetched: number;
  collected: number;
  hasMore: boolean;
  nextOffset: number | null;
  includeReferenceMatches: boolean;
  referenceDepthRequested: number;
  referenceDepthUsed: number | null;
  referenceDepthAttempts: number[];
  referenceAutoExpandUsed: boolean;
  referenceDepthLimit: number | null;
  referenceAnchors: string[];
  referenceTotalCount: number;
  markdown: string;
  highlights: TopicActivityHighlight[];
  referenceIndex: unknown;
  items?: TopicActivityItem[];
  groups?: TopicActivityGroup[];
};

export async function executeSummarizeTopicActivity(
  params: SummarizeTopicActivityInput,
): Promise<SummarizeTopicActivityResult> {
  const parsed = parseOrThrow(summarizeTopicActivitySchema, params, { label: 'summarize_topic_activity' });
  const keywords = parsed.keywords ?? [];
  const query = (parsed.query ?? keywords.join(' ')).trim();
  if (!query) {
    throw new Error('You must provide query or keywords');
  }

  const maxResults = parsed.maxResults ?? 8;
  const maxNodesPerResult = parsed.maxNodesPerResult ?? 60;
  const expandReferences = parsed.expandReferences ?? true;
  const maxReferenceDepth = parsed.maxReferenceDepth ?? 1;
  const includeEmpty = parsed.includeEmpty ?? false;
  const excludeProperties = parsed.excludeProperties ?? true;
  const groupBy: GroupBy = parsed.groupBy ?? 'parent';
  const searchLimit = parsed.searchLimit ?? Math.min(maxResults * 3, 60);
  const timeoutMs =
    typeof parsed.timeoutMs === 'number' ? Math.max(1, Math.min(30_000, Math.floor(parsed.timeoutMs))) : 30_000;
  const {
    filters: _timeFilters,
    summary: filterSummary,
    effectiveTimeRange,
  } = resolveTimeFilters(parsed, { defaultTimeRange: '30d' });
  const searchTimeRange = parsed.timeRange ?? effectiveTimeRange;
  const detail = parsed.detail ?? false;

  const includeReferenceMatches = parsed.includeReferenceMatches ?? true;
  const requestedReferenceDepth = parsed.referenceDepth ?? 1;
  const maxReferenceCandidates = parsed.maxReferenceCandidates ?? 200;

  const anchorIds = new Set(parsed.referenceIds ?? []);

  const collected = new Map<string, AggregatedMatch>();
  const orderedIds: string[] = [];
  const referenceIndex = new Map<string, ReferenceIndexEntry>();

  const ensureMatch = (id: string) => {
    let entry = collected.get(id);
    if (!entry) {
      entry = {
        id,
        title: null,
        snippet: null,
        ancestor: null,
        ancestorIds: [],
        parentId: null,
        matchedBy: new Set(),
        matchedTargets: new Set(),
        anchorIds: new Set(),
        sourceIds: new Set(),
      };
      collected.set(id, entry);
      orderedIds.push(id);
    }
    return entry;
  };

  // If no anchor is provided, run a loose search to pick candidate concept Rems.
  if (anchorIds.size === 0) {
    const anchorSearch = await executeSearchRemOverview({
      query,
      limit: 5,
      mode: parsed.mode,
      dbPath: parsed.dbPath,
      timeoutMs,
    });
    for (const match of anchorSearch.matches) {
      anchorIds.add(match.id);
    }
  }

  let offset = parsed.offset ?? 0;
  let iterations = 0;
  let lastSearchResult: Awaited<ReturnType<typeof executeSearchRemOverview>> | null = null;
  let totalFetched = 0;

  while (collected.size < maxResults && iterations < 6) {
    const searchResult = await executeSearchRemOverview({
      query,
      limit: searchLimit,
      offset,
      mode: parsed.mode,
      dbPath: parsed.dbPath,
      timeoutMs,
      ...(searchTimeRange ? { timeRange: searchTimeRange } : {}),
      createdAfter: parsed.createdAfter,
      createdBefore: parsed.createdBefore,
      updatedAfter: parsed.updatedAfter,
      updatedBefore: parsed.updatedBefore,
    });

    lastSearchResult = searchResult;
    totalFetched += searchResult.matches.length;

    const matches = searchResult.matches as Array<{
      id: string;
      title?: string | null;
      snippet?: string | null;
      ancestor?: string | null;
      parentId?: string | null;
      ancestorIds?: string[];
    }>;

    for (const match of matches) {
      const entry = ensureMatch(match.id);
      entry.matchedBy.add('text');
      if (!entry.title && match.title) entry.title = match.title;
      if (!entry.snippet && match.snippet) entry.snippet = match.snippet;
      if (!entry.ancestor && match.ancestor) entry.ancestor = match.ancestor;
      if (entry.ancestorIds.length === 0 && Array.isArray(match.ancestorIds) && match.ancestorIds.length > 0) {
        entry.ancestorIds = match.ancestorIds;
      }
      entry.parentId ??= match.parentId ?? null;
    }

    if (!searchResult.hasMore || searchResult.nextOffset == null) {
      break;
    }
    offset = searchResult.nextOffset;
    iterations += 1;
  }

  let referenceTotalCount = 0;
  let referenceDepthUsed: number | null = includeReferenceMatches ? requestedReferenceDepth : null;
  let referenceDepthAttempts: number[] = [];
  let referenceAutoExpandUsed = includeReferenceMatches;
  let referenceDepthLimit: number | null = includeReferenceMatches ? requestedReferenceDepth : null;

  if (includeReferenceMatches && anchorIds.size > 0) {
    const referenceArgs: FindRemsByReferenceInput = {
      targetIds: Array.from(anchorIds),
      maxDepth: requestedReferenceDepth,
      maxCandidates: maxReferenceCandidates,
      limit: maxReferenceCandidates,
      offset: 0,
      timeRange: parsed.timeRange ?? filterSummary.timeRange ?? undefined,
      createdAfter: parsed.createdAfter,
      createdBefore: parsed.createdBefore,
      updatedAfter: parsed.updatedAfter,
      updatedBefore: parsed.updatedBefore,
      dbPath: parsed.dbPath,
    };

    const referenceResult = await executeFindRemsByReference(referenceArgs);
    referenceTotalCount = referenceResult.totalCount;
    const appliedDepth = referenceResult.depthApplied ?? requestedReferenceDepth;

    for (const match of referenceResult.matches) {
      const entry = ensureMatch(match.id);
      entry.matchedBy.add('reference');
      if (!entry.title && match.title) entry.title = match.title;
      if (!entry.snippet && match.snippet) entry.snippet = match.snippet;
      if (!entry.ancestor && match.ancestor) entry.ancestor = match.ancestor;
      if (entry.ancestorIds.length === 0 && match.ancestorIds && match.ancestorIds.length > 0) {
        entry.ancestorIds = match.ancestorIds;
      }
      entry.parentId ??= match.parentId ?? null;
      if (match.matchedTargets) {
        for (const target of match.matchedTargets) {
          entry.matchedTargets.add(target);
        }
      }
      if (match.anchorIds) {
        for (const anchor of match.anchorIds) {
          entry.anchorIds.add(anchor);
        }
      }
      if (match.sourceIds) {
        for (const source of match.sourceIds) {
          entry.sourceIds.add(source);
        }
      }
      entry.referenceDepth = entry.referenceDepth
        ? Math.min(entry.referenceDepth, match.depth ?? appliedDepth)
        : (match.depth ?? appliedDepth);
      entry.updatedAt = chooseLatest(entry.updatedAt ?? null, match.updatedAt ?? null);
      entry.createdAt = chooseLatest(entry.createdAt ?? null, match.createdAt ?? null);
    }
    referenceDepthUsed = appliedDepth;
    referenceDepthAttempts = referenceResult.depthAttempts ?? [];
    referenceAutoExpandUsed = referenceResult.autoExpandDepth ?? includeReferenceMatches;
    referenceDepthLimit = referenceResult.depthLimit ?? appliedDepth;
  }

  const orderedMatches = orderedIds.map((id) => collected.get(id)!).slice(0, maxResults);

  const items: TopicActivityItem[] = [];
  for (const match of orderedMatches) {
    try {
      const outline = await executeOutlineRemSubtree({
        id: match.id,
        dbPath: parsed.dbPath,
        includeEmpty,
        expandReferences,
        maxReferenceDepth,
        startOffset: 0,
        maxNodes: maxNodesPerResult,
        format: 'markdown',
        excludeProperties,
        detail: true,
      });

      const markdown = outline.markdown;
      const lineCount = markdown ? markdown.split('\n').length : 0;
      const nodes = Array.isArray((outline as { tree?: OutlineNodeSummary[] }).tree)
        ? ((outline as { tree?: OutlineNodeSummary[] }).tree ?? [])
        : [];
      collectReferenceSummaries(referenceIndex, nodes, match.id, outline.title ?? match.title ?? match.id);

      const item: TopicActivityItem = {
        remId: match.id,
        title: match.title ?? outline.title ?? match.id,
        ancestor: match.ancestor,
        ancestorIds: match.ancestorIds,
        parentId: match.parentId,
        snippet: match.snippet,
        truncated: Boolean(outline.hasMore || lineCount > maxNodesPerResult),
        matchedBy: Array.from(match.matchedBy),
        matchedTargets: Array.from(match.matchedTargets),
        anchorIds: Array.from(match.anchorIds),
        sourceIds: Array.from(match.sourceIds),
        referenceDepth: match.referenceDepth,
        updatedAt: match.updatedAt ?? null,
        createdAt: match.createdAt ?? null,
        markdown,
        outlineTitle: outline.title,
        nodeCount: outline.nodeCount,
        totalNodeCount: outline.totalNodeCount,
        hasMore: outline.hasMore,
        nextOffset: outline.nextOffset,
      };
      if (detail) {
        item.nodes = nodes;
      }
      items.push(item);
    } catch (error) {
      items.push({
        remId: match.id,
        title: match.title ?? match.id,
        ancestor: match.ancestor,
        ancestorIds: match.ancestorIds,
        parentId: match.parentId,
        snippet: match.snippet,
        truncated: false,
        matchedBy: Array.from(match.matchedBy),
        matchedTargets: Array.from(match.matchedTargets),
        anchorIds: Array.from(match.anchorIds),
        sourceIds: Array.from(match.sourceIds),
        referenceDepth: match.referenceDepth,
        updatedAt: match.updatedAt ?? null,
        createdAt: match.createdAt ?? null,
        error: String(error),
      });
    }
  }

  const groups = groupItems(items, groupBy);
  const aggregateMarkdown = buildAggregateMarkdown(groups, groupBy);
  const highlights = buildHighlights(items);
  const referenceIndexData = convertReferenceIndex(referenceIndex);
  const count = items.length;

  const info = lastSearchResult ?? {
    dbPath: parsed.dbPath ?? '',
    resolution: 'explicit' as const,
    dirName: undefined,
    queryUsed: query,
    totalFetched: 0,
    matches: [],
    count: 0,
    offset: 0,
    limit: 0,
    hasMore: false,
    nextOffset: null,
    filtersApplied: null,
  };

  const response: SummarizeTopicActivityResult = {
    dbPath: info.dbPath,
    resolution: info.resolution,
    dirName: info.dirName,
    queryUsed: info.queryUsed ?? query,
    keywords,
    groupBy,
    timeRange: filterSummary.timeRange ?? null,
    filtersApplied: filterSummary,
    count,
    maxResults,
    maxNodesPerResult,
    totalFetched,
    collected: items.length,
    hasMore: info.hasMore,
    nextOffset: info.nextOffset,
    includeReferenceMatches,
    referenceDepthRequested: requestedReferenceDepth,
    referenceDepthUsed,
    referenceDepthAttempts,
    referenceAutoExpandUsed,
    referenceDepthLimit,
    referenceAnchors: Array.from(anchorIds),
    referenceTotalCount,
    markdown: aggregateMarkdown || 'No related Rem found.',
    highlights,
    referenceIndex: referenceIndexData,
  };
  if (detail) {
    response.items = items;
    response.groups = groups;
  }
  return response;
}

function groupItems(items: TopicActivityItem[], groupBy: GroupBy): TopicActivityGroup[] {
  if (groupBy === 'none') {
    return [
      {
        key: 'all',
        label: 'All',
        items,
      },
    ];
  }

  const map = new Map<string, TopicActivityGroup>();
  for (const item of items) {
    const key = groupBy === 'parent' ? determineParentLabel(item) : determineDateLabel(item);
    const existing = map.get(key.key);
    if (existing) {
      existing.items.push(item);
    } else {
      map.set(key.key, {
        key: key.key,
        label: key.label,
        items: [item],
      });
    }
  }
  return Array.from(map.values());
}

function determineParentLabel(item: TopicActivityItem): { key: string; label: string } {
  const label = item.ancestor && item.ancestor.trim() ? item.ancestor.trim() : 'Uncategorized';
  return { key: label, label };
}

function determineDateLabel(item: TopicActivityItem): { key: string; label: string } {
  const candidates = [item.outlineTitle, item.title, item.snippet, item.markdown?.split('\n')[0]];
  for (const candidate of candidates) {
    const normalized = extractDate(candidate);
    if (normalized) {
      return { key: normalized, label: normalized };
    }
  }
  return { key: 'unparsed_date', label: 'Unparsed Date' };
}

function extractDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const isoMatch = trimmed.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (isoMatch) {
    return normalizeDateParts(isoMatch[1], isoMatch[2], isoMatch[3]);
  }
  const dotMatch = trimmed.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (dotMatch) {
    return normalizeDateParts(dotMatch[1], dotMatch[2], dotMatch[3]);
  }
  const cnMatch = trimmed.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cnMatch) {
    return normalizeDateParts(cnMatch[1], cnMatch[2], cnMatch[3]);
  }
  return null;
}

function normalizeDateParts(year: string, month: string, day: string): string {
  const y = year.padStart(4, '0');
  const m = month.padStart(2, '0');
  const d = day.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildAggregateMarkdown(groups: TopicActivityGroup[], groupBy: GroupBy): string {
  const lines: string[] = [];

  if (groups.every((group) => group.items.length === 0)) {
    return 'No related Rem found.';
  }

  for (const group of groups) {
    if (groupBy !== 'none') {
      lines.push(`## ${group.label}`);
    }

    for (const item of group.items) {
      const title = item.outlineTitle || item.title || item.remId;
      const truncatedNote = item.truncated ? ' _(truncated)_' : '';
      lines.push(`- **${title}**${truncatedNote}`);
      if (item.ancestor && groupBy !== 'parent') {
        lines.push(`  - Parent: ${item.ancestor}`);
      }
      if (item.matchedBy.length > 0) {
        const sourceLabel = item.matchedBy.map((source) => (source === 'text' ? 'text' : 'reference')).join(' + ');
        lines.push(`  - Matched by: ${sourceLabel}`);
      }
      if (item.referenceDepth) {
        lines.push(`  - Reference depth: ${item.referenceDepth}`);
      }
      if (item.anchorIds && item.anchorIds.length > 0) {
        lines.push(`  - Anchors: ${item.anchorIds.join(', ')}`);
      }
      if (item.matchedTargets && item.matchedTargets.length > 0) {
        lines.push(`  - Reference targets: ${item.matchedTargets.join(', ')}`);
      }
      if (item.markdown) {
        lines.push(indentMarkdown(item.markdown, '  '));
      } else if (item.snippet) {
        lines.push(`  - Snippet: ${item.snippet}`);
      }
      if (item.error) {
        lines.push(`  - Failed to read: ${item.error}`);
      } else if (item.truncated) {
        lines.push(`  - Tip: use outline_rem_subtree id=${item.remId} to fetch full content`);
      }
    }

    lines.push('');
  }

  return lines.join('\n').trim();
}

function indentMarkdown(content: string, prefix: string): string {
  return content
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function chooseLatest(current: number | null | undefined, incoming: number | null) {
  if (incoming == null) return current ?? null;
  if (current == null) return incoming;
  return Math.max(current, incoming);
}

function buildHighlights(items: TopicActivityItem[]): TopicActivityHighlight[] {
  return items.map((item) => ({
    remId: item.remId,
    title: item.title,
    ancestor: item.ancestor,
    matchedBy: item.matchedBy,
    truncated: item.truncated,
    referenceDepth: item.referenceDepth ?? null,
    anchorIds: item.anchorIds ?? [],
    matchedTargets: item.matchedTargets ?? [],
    hasMore: Boolean(item.hasMore),
  }));
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
