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

  it('move_rem derives rem + children keys (from/to)', () => {
    const keys = deriveConflictKeys('move_rem', { remId: 'r1', fromParentId: 'p1', toParentId: 'p2' });
    expect(keys).toEqual(['rem:r1', 'children:p2', 'children:p1']);
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

  it('falls back to global:unknown when no identifiers exist', () => {
    const keys = deriveConflictKeys('update_text', { text: 'x' });
    expect(keys).toEqual(['global:unknown']);
  });
});
