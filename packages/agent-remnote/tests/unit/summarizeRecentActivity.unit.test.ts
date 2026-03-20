import { describe, expect, it } from 'vitest';

import { executeSummarizeRecentActivity } from '../../src/internal/remdb-tools/summarizeRecentActivity.js';

describe('unit: summarizeRecentActivity', () => {
  it('rejects invalid numeric inputs before touching the database', () => {
    const fakeDb = {} as any;

    expect(() =>
      executeSummarizeRecentActivity(fakeDb, {
        days: 0,
        kind: 'all',
        aggregates: [],
        timezone: 'UTC',
        itemLimit: 10,
        aggregateLimit: 10,
      }),
    ).toThrow('days must be an integer >= 1');

    expect(() =>
      executeSummarizeRecentActivity(fakeDb, {
        days: 1,
        kind: 'all',
        aggregates: [],
        timezone: 'UTC',
        itemLimit: 0,
        aggregateLimit: 10,
      }),
    ).toThrow('itemLimit must be an integer >= 1');

    expect(() =>
      executeSummarizeRecentActivity(fakeDb, {
        days: 1,
        kind: 'all',
        aggregates: [],
        timezone: 'UTC',
        itemLimit: 10,
        aggregateLimit: 0,
      }),
    ).toThrow('aggregateLimit must be an integer >= 1');
  });

  it('rejects invalid kind and aggregate values', () => {
    const fakeDb = {} as any;

    expect(() =>
      executeSummarizeRecentActivity(fakeDb, {
        days: 1,
        kind: 'weird' as any,
        aggregates: [],
        timezone: 'UTC',
        itemLimit: 10,
        aggregateLimit: 10,
      }),
    ).toThrow("kind must be 'all', 'created', or 'modified_existing'");

    expect(() =>
      executeSummarizeRecentActivity(fakeDb, {
        days: 1,
        kind: 'all',
        aggregates: ['day', 'mystery'] as any,
        timezone: 'UTC',
        itemLimit: 10,
        aggregateLimit: 10,
      }),
    ).toThrow("aggregates must contain only 'day' or 'parent'");
  });
});
