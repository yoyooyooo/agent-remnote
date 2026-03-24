import { describe, expect, it } from 'vitest';

import { deriveConflictKeys } from '../../src/kernel/conflicts/index.js';

describe('conflict keys: deriveConflictKeys', () => {
  it('create_rem derives parent structure keys', () => {
    const keys = deriveConflictKeys('create_rem', { parentId: 'p1', text: 'hello' });
    expect(keys).toEqual(['rem:p1', 'children:p1']);
  });

  it('create_portal derives parent + target keys', () => {
    const keys = deriveConflictKeys('create_portal', { parentId: 'p1', targetRemId: 'r1', position: 0 });
    expect(keys).toEqual(['rem:p1', 'children:p1', 'rem:r1']);
  });

  it('create_portal_bulk derives parent structure keys plus all target rem keys', () => {
    const keys = deriveConflictKeys('create_portal_bulk', {
      parent_id: 'p1',
      items: [{ target_rem_id: 'r1' }, { target_rem_id: 'r2', position: 2 }],
    });
    expect(keys).toEqual(['rem:p1', 'children:p1', 'rem:r1', 'rem:r2']);
  });

  it('add_tag_bulk derives rem-scoped keys for all target rems', () => {
    const keys = deriveConflictKeys('add_tag_bulk', {
      items: [
        { rem_id: 'r1', tag_id: 't1' },
        { rem_id: 'r2', tag_id: 't1' },
      ],
    });
    expect(keys).toEqual(['rem:r1', 'rem:r2']);
  });

  it('add_source_bulk derives rem-scoped keys for all target rems', () => {
    const keys = deriveConflictKeys('add_source_bulk', {
      items: [
        { rem_id: 'r1', source_id: 's1' },
        { rem_id: 'r2', source_id: 's1' },
      ],
    });
    expect(keys).toEqual(['rem:r1', 'rem:r2']);
  });

  it('move_rem derives rem + children keys (from/to)', () => {
    const keys = deriveConflictKeys('move_rem', { remId: 'r1', fromParentId: 'p1', toParentId: 'p2' });
    expect(keys).toEqual(['rem:r1', 'children:p2', 'children:p1']);
  });

  it('move_rem derives children key from new_parent_id', () => {
    const keys = deriveConflictKeys('move_rem', { rem_id: 'r1', new_parent_id: 'p3' });
    expect(keys).toEqual(['rem:r1', 'children:p3']);
  });

  it('move_rem_bulk derives per-rem keys plus destination children key', () => {
    const keys = deriveConflictKeys('move_rem_bulk', {
      rem_ids: ['r1', 'r2', 'r3'],
      new_parent_id: 'p3',
    });
    expect(keys).toEqual(['rem:r1', 'rem:r2', 'rem:r3', 'children:p3']);
  });

  it('replace_selection_with_markdown derives explicit rem targets', () => {
    const keys = deriveConflictKeys('replace_selection_with_markdown', {
      remId: 'r1',
      target: { mode: 'explicit', remIds: ['r2', 'r3'] },
    });
    expect(keys).toEqual(['rem:r1', 'rem:r2', 'rem:r3']);
  });

  it('daily_note_write is globally exclusive', () => {
    const keys = deriveConflictKeys('daily_note_write', { text: 'x' });
    expect(keys).toEqual(['global:daily_note_write']);
  });

  it('delete_backup_artifact falls back to global:structure_unknown when rem_id is missing', () => {
    const keys = deriveConflictKeys('delete_backup_artifact', {});
    expect(keys).toEqual(['global:structure_unknown']);
  });

  it('falls back to global:unknown when no identifiers exist', () => {
    const keys = deriveConflictKeys('update_text', { text: 'x' });
    expect(keys).toEqual(['global:unknown']);
  });
});
