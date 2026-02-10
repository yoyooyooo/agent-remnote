import type { StoreDB } from '../db.js';

export const migration = {
  version: 1,
  name: 'baseline',
  checksumInput: 'store_schema_baseline_v1',
  apply: (_db: StoreDB) => {},
} as const;

