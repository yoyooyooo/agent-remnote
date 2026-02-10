import { describe, expect, it } from 'vitest';

import { collectTempIdsFromPayload, substituteTempIdsInPayload } from '../../src/kernel/op-catalog/index.js';

describe('op catalog temp id substitution', () => {
  it('supports alias op type and nested array id paths', () => {
    const payload = {
      table_tag_id: 'tmp:table',
      parent_id: 'tmp:parent',
      values: [
        { property_id: 'tmp:col-a', value: 'A' },
        { property_id: 'col-existing', value: 'B' },
      ],
    };

    const tempIds = collectTempIdsFromPayload('table.addRow', payload);
    expect(tempIds).toEqual(expect.arrayContaining(['tmp:table', 'tmp:parent', 'tmp:col-a']));

    const mapped = substituteTempIdsInPayload('table.addRow', payload, {
      'tmp:table': 'table-1',
      'tmp:parent': 'rem-1',
      'tmp:col-a': 'prop-1',
    }) as typeof payload;

    expect(mapped.table_tag_id).toBe('table-1');
    expect(mapped.parent_id).toBe('rem-1');
    expect(mapped.values[0]?.property_id).toBe('prop-1');
    expect(mapped.values[1]?.property_id).toBe('col-existing');

    expect(payload.table_tag_id).toBe('tmp:table');
    expect(payload.values[0]?.property_id).toBe('tmp:col-a');
  });
});
