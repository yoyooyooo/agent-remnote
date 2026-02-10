import { describe, expect, it } from 'vitest';

import { canonicalizeOpType, idFieldPathsForOpType } from '../../src/kernel/op-catalog/index.js';

describe('op catalog normalization', () => {
  it('canonicalizes known alias to canonical type', () => {
    expect(canonicalizeOpType('table.addRow')).toBe('table_add_row');
    expect(canonicalizeOpType('rem.create')).toBe('create_rem');
  });

  it('keeps canonical type unchanged', () => {
    expect(canonicalizeOpType('create_rem')).toBe('create_rem');
  });

  it('falls back to original type when alias is unknown', () => {
    expect(canonicalizeOpType('x.custom')).toBe('x.custom');
  });

  it('resolves id fields for alias using canonical catalog', () => {
    expect(idFieldPathsForOpType('table.addRow')).toContain('table_tag_id');
    expect(idFieldPathsForOpType('table.addRow')).toContain('parent_id');
  });
});

