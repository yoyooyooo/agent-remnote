import { z } from 'zod';

export const TIME_RANGE_PATTERN = /^(\d+)\s*([hdwmy])$/i;
// Allow treating "all" or "*" as no time limit (i.e. do not apply any time filters).
const ALL_TIME_RANGE_TOKENS = new Set(['all', '*']);

export const timeValueSchema = z.union([z.number().finite(), z.string().min(1)]);

export type TimeFilterInput = {
  timeRange?: string;
  createdAfter?: unknown;
  createdBefore?: unknown;
  updatedAfter?: unknown;
  updatedBefore?: unknown;
};

export type TimeFilters = {
  createdAfter?: number;
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;
};

export type TimestampDescriptor = {
  ms: number;
  iso: string;
};

export type FilterSummary = {
  timeRange?: string | null;
  createdAfter?: TimestampDescriptor | null;
  createdBefore?: TimestampDescriptor | null;
  updatedAfter?: TimestampDescriptor | null;
  updatedBefore?: TimestampDescriptor | null;
};

export type ResolveTimeFiltersOptions = {
  defaultTimeRange?: string;
};

export function resolveTimeFilters(
  input: TimeFilterInput,
  options?: ResolveTimeFiltersOptions,
): { filters: TimeFilters; summary: FilterSummary; effectiveTimeRange?: string } {
  const filters: TimeFilters = {};
  const summary: FilterSummary = {};
  // Keep it defined across branches to avoid reference errors.
  let effectiveTimeRange: string | undefined;

  const explicitProvided =
    input.timeRange !== undefined ||
    input.createdAfter !== undefined ||
    input.createdBefore !== undefined ||
    input.updatedAfter !== undefined ||
    input.updatedBefore !== undefined;

  // Normalize timeRange string
  const normalizedTimeRange = typeof input.timeRange === 'string' ? input.timeRange.trim().toLowerCase() : undefined;

  // If explicitly provided all/*, treat as no time limit: do not apply any time filters.
  if (normalizedTimeRange && ALL_TIME_RANGE_TOKENS.has(normalizedTimeRange)) {
    summary.timeRange = input.timeRange ?? 'all';
    // Skip default timeRange and threshold calculation.
  } else {
    effectiveTimeRange = input.timeRange ?? (!explicitProvided ? options?.defaultTimeRange : undefined);

    if (effectiveTimeRange) {
      const durationMs = parseTimeRange(effectiveTimeRange);
      if (durationMs == null) {
        throw new Error("Failed to parse timeRange. Expected formats like '30d', '2w', '12h'.");
      }
      const threshold = Date.now() - durationMs;
      if (input.updatedAfter === undefined) {
        filters.updatedAfter = threshold;
        summary.updatedAfter = describeTimestamp(threshold);
      }
      if (input.createdAfter === undefined) {
        filters.createdAfter = threshold;
        summary.createdAfter = describeTimestamp(threshold);
      }
      summary.timeRange = effectiveTimeRange;
    }
  }

  const explicitMappings: Array<{
    key: keyof TimeFilters;
    value: unknown;
    summaryKey: Exclude<keyof FilterSummary, 'timeRange'>;
  }> = [
    { key: 'createdAfter', value: input.createdAfter, summaryKey: 'createdAfter' },
    { key: 'createdBefore', value: input.createdBefore, summaryKey: 'createdBefore' },
    { key: 'updatedAfter', value: input.updatedAfter, summaryKey: 'updatedAfter' },
    { key: 'updatedBefore', value: input.updatedBefore, summaryKey: 'updatedBefore' },
  ];

  for (const entry of explicitMappings) {
    if (entry.value === undefined || entry.value === null) continue;
    const parsed = parseTemporalInput(entry.value);
    if (parsed == null) {
      throw new Error(`${entry.summaryKey} parse failed. Provide a millisecond timestamp or an ISO date string.`);
    }
    (filters as Record<string, number>)[entry.key] = parsed;
    summary[entry.summaryKey] = describeTimestamp(parsed);
  }

  return { filters, summary, effectiveTimeRange };
}

export function parseTemporalInput(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      return Number.isFinite(num) ? Math.trunc(num) : null;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return parsed;
  }
  return null;
}

export function parseTimeRange(input: string): number | null {
  const match = input.match(TIME_RANGE_PATTERN);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  const base = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  } as const;
  const multiplier = base[unit as keyof typeof base];
  if (!multiplier) return null;
  return value * multiplier;
}

export function describeTimestamp(ms: number): TimestampDescriptor {
  return {
    ms,
    iso: new Date(ms).toISOString(),
  };
}

export function describeFilterSummary(summary: FilterSummary | undefined): string | null {
  if (!summary) return null;
  const parts: string[] = [];
  if (summary.timeRange) {
    parts.push(`timeRange=${summary.timeRange}`);
  }
  if (summary.updatedAfter) {
    parts.push(`updated>=${summary.updatedAfter.iso}`);
  }
  if (summary.updatedBefore) {
    parts.push(`updated<=${summary.updatedBefore.iso}`);
  }
  if (summary.createdAfter) {
    parts.push(`created>=${summary.createdAfter.iso}`);
  }
  if (summary.createdBefore) {
    parts.push(`created<=${summary.createdBefore.iso}`);
  }
  if (parts.length === 0) return null;
  return parts.join(', ');
}
