import { migration as m0001 } from './0001-baseline.js';
import { migration as m0002 } from './0002-add-ops-attempt-id.js';
import { migration as m0003 } from './0003-add-op-attempts-table.js';
import { migration as m0004 } from './0004-add-txns-dispatch-mode.js';
import { migration as m0005 } from './0005-prefix-queue-tables.js';

export type MigrationSpec = {
  readonly version: number;
  readonly name: string;
  readonly checksumInput: string;
  readonly apply: (db: import('../db.js').StoreDB) => void;
};

export const migrationSpecs: readonly MigrationSpec[] = [m0001, m0002, m0003, m0004, m0005];
