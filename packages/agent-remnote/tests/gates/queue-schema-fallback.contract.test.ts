import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { __TEST_FALLBACK_SCHEMA_SQL } from '../../src/internal/store/db.js';

function normalizeSql(raw: string): string {
  return raw.replace(/\r\n/g, '\n').trimEnd() + '\n';
}

describe('store schema snapshot: fallback stays in sync', () => {
  it('keeps FALLBACK_SCHEMA_SQL aligned with schema.sql', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const schemaPath = path.join(__dirname, '../../src/internal/store/schema.sql');

    const schemaSql = await fs.readFile(schemaPath, 'utf8');

    expect(normalizeSql(__TEST_FALLBACK_SCHEMA_SQL)).toBe(normalizeSql(schemaSql));
  });
});
