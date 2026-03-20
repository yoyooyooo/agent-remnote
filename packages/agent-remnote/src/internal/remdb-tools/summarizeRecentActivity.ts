import type { BetterSqliteInstance } from './shared.js';

export type RecentActivityKind = 'created' | 'modified_existing';
export type RecentActivityAggregateDimension = 'day' | 'parent';

export type RecentActivityItem = {
  readonly id: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly activity_kind: RecentActivityKind;
  readonly preview: string;
  readonly parent_id: string | null;
  readonly parent_preview: string | null;
};

export type RecentActivityAggregate = {
  readonly dimension: RecentActivityAggregateDimension;
  readonly key: string;
  readonly counts: {
    readonly total: number;
    readonly created: number;
    readonly modified_existing: number;
  };
  readonly samples: readonly RecentActivityItem[];
  readonly parent_id?: string | null;
  readonly parent_preview?: string | null;
  readonly timezone?: string | null;
};

export type SummarizeRecentActivityInput = {
  readonly days: number;
  readonly kind: 'all' | RecentActivityKind;
  readonly aggregates: readonly RecentActivityAggregateDimension[];
  readonly timezone: string;
  readonly itemLimit: number;
  readonly aggregateLimit: number;
  readonly now?: number | undefined;
};

export type SummarizeRecentActivityResult = {
  readonly days: number;
  readonly timezone: string;
  readonly cutoff_ms: number;
  readonly counts: {
    readonly total: number;
    readonly created: number;
    readonly modified_existing: number;
  };
  readonly items: readonly RecentActivityItem[];
  readonly aggregates: readonly RecentActivityAggregate[];
};

type RecentCandidateRow = {
  readonly id: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly preview: string;
  readonly parent_id: string | null;
  readonly parent_preview: string | null;
};

type RecentCandidate = RecentActivityItem & {
  readonly activity_at: number;
};

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function cleanTitle(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.split(/\s+/).join(' ').trim();
}

function assertTimezone(timezone: string): string {
  const effective = timezone.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  new Intl.DateTimeFormat('en-CA', { timeZone: effective, year: 'numeric', month: '2-digit', day: '2-digit' });
  return effective;
}

function dayKeyFromMs(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';
  return `${year}-${month}-${day}`;
}

function buildCounts(items: readonly RecentActivityItem[]) {
  const created = items.filter((item) => item.activity_kind === 'created').length;
  const modifiedExisting = items.filter((item) => item.activity_kind === 'modified_existing').length;
  return {
    total: items.length,
    created,
    modified_existing: modifiedExisting,
  } as const;
}

function toAggregateItems(items: readonly RecentCandidate[]): readonly RecentActivityItem[] {
  return items.map(({ activity_at: _activityAt, ...item }) => item);
}

function summarizeByDay(items: readonly RecentCandidate[], timezone: string, limit: number): readonly RecentActivityAggregate[] {
  const groups = new Map<string, RecentCandidate[]>();
  for (const item of items) {
    const key = dayKeyFromMs(item.activity_at, timezone);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }

  return Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, limit)
    .map(([key, group]) => ({
      dimension: 'day' as const,
      key,
      counts: buildCounts(group),
      samples: toAggregateItems(group.slice(0, 3)),
      timezone,
    }));
}

function summarizeByParent(items: readonly RecentCandidate[], limit: number): readonly RecentActivityAggregate[] {
  const groups = new Map<string, RecentCandidate[]>();
  for (const item of items) {
    const key = item.parent_id ?? '(root)';
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }

  return Array.from(groups.entries())
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, group]) => ({
      dimension: 'parent' as const,
      key,
      counts: buildCounts(group),
      samples: toAggregateItems(group.slice(0, 3)),
      parent_id: group[0]?.parent_id ?? null,
      parent_preview: group[0]?.parent_preview ?? null,
    }));
}

export function executeSummarizeRecentActivity(
  db: BetterSqliteInstance,
  params: SummarizeRecentActivityInput,
): SummarizeRecentActivityResult {
  if (!Number.isInteger(params.days) || params.days < 1) {
    throw new RangeError('days must be an integer >= 1');
  }
  if (!Number.isInteger(params.itemLimit) || params.itemLimit < 1) {
    throw new RangeError('itemLimit must be an integer >= 1');
  }
  if (!Number.isInteger(params.aggregateLimit) || params.aggregateLimit < 1) {
    throw new RangeError('aggregateLimit must be an integer >= 1');
  }
  if (params.kind !== 'all' && params.kind !== 'created' && params.kind !== 'modified_existing') {
    throw new RangeError("kind must be 'all', 'created', or 'modified_existing'");
  }
  const aggregateDimensions = Array.from(new Set(params.aggregates));
  if (aggregateDimensions.some((dimension) => dimension !== 'day' && dimension !== 'parent')) {
    throw new RangeError("aggregates must contain only 'day' or 'parent'");
  }

  const now = params.now ?? Date.now();
  const cutoffMs = now - params.days * 24 * 60 * 60 * 1000;
  const timezone = assertTimezone(params.timezone);

  const rows = db
    .prepare(
      `
        select
          q._id as id,
          cast(json_extract(q.doc, '$.createdAt') as integer) as createdAt,
          cast(coalesce(json_extract(q.doc, '$.m'), json_extract(q.doc, '$.createdAt')) as integer) as updatedAt,
          json_extract(r.doc, '$.r') as preview,
          json_extract(q.doc, '$.parent') as parentId,
          json_extract(pr.doc, '$.r') as parentPreview
        from quanta q
        join remsSearchInfos r on r.id = q._id
        left join remsSearchInfos pr on pr.id = json_extract(q.doc, '$.parent')
        where
          cast(json_extract(q.doc, '$.createdAt') as integer) >= @cutoffMs
          or cast(coalesce(json_extract(q.doc, '$.m'), json_extract(q.doc, '$.createdAt')) as integer) >= @cutoffMs
      `,
    )
    .all({ cutoffMs }) as Array<{
    id: string;
    createdAt: unknown;
    updatedAt: unknown;
    preview: unknown;
    parentId: unknown;
    parentPreview: unknown;
  }>;

  const candidates: RecentCandidate[] = rows
    .map((row) => {
      const createdAt = asInt(row.createdAt);
      const updatedAt = asInt(row.updatedAt);
      if (createdAt === null || updatedAt === null) {
        return null;
      }

      const base: RecentCandidateRow = {
        id: String(row.id),
        created_at: createdAt,
        updated_at: updatedAt,
        preview: cleanTitle(row.preview) || '<no preview>',
        parent_id: typeof row.parentId === 'string' && row.parentId.trim() ? row.parentId.trim() : null,
        parent_preview: cleanTitle(row.parentPreview) || null,
      };

      if (base.created_at >= cutoffMs) {
        return {
          ...base,
          activity_kind: 'created' as const,
          activity_at: base.created_at,
        };
      }

      if (base.updated_at >= cutoffMs && base.created_at < cutoffMs) {
        return {
          ...base,
          activity_kind: 'modified_existing' as const,
          activity_at: base.updated_at,
        };
      }

      return null;
    })
    .filter((value): value is RecentCandidate => value !== null)
    .filter((item) => params.kind === 'all' || item.activity_kind === params.kind)
    .sort((a, b) => b.activity_at - a.activity_at || a.id.localeCompare(b.id));

  const counts = buildCounts(candidates);
  const items = toAggregateItems(candidates.slice(0, params.itemLimit));

  const aggregates: RecentActivityAggregate[] = [];
  for (const dimension of aggregateDimensions) {
    if (dimension === 'day') {
      aggregates.push(...summarizeByDay(candidates, timezone, params.aggregateLimit));
      continue;
    }
    if (dimension === 'parent') {
      aggregates.push(...summarizeByParent(candidates, params.aggregateLimit));
    }
  }

  return {
    days: params.days,
    timezone,
    cutoff_ms: cutoffMs,
    counts,
    items,
    aggregates,
  };
}
