import { describe, expect, it } from 'vitest';

import { compileWritePlanV1, decideOutlineWriteShape, parseWritePlanV1 } from '../../src/kernel/write-plan/index.js';

describe('write plan kernel: parse/compile', () => {
  it('compiles a simple plan and injects client_temp_id for aliased create ops', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        {
          as: 'a',
          action: 'write.bullet',
          input: { parent_id: 'p1', text: 'hello' },
        },
      ],
    });

    const compiled = compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' });
    expect(compiled.alias_map.a).toBe('tmp:1');
    expect(compiled.ops).toHaveLength(1);
    expect(compiled.ops[0]!.type).toBe('create_rem');
    expect(compiled.ops[0]!.payload.client_temp_id).toBe('tmp:1');
  });

  it('replaces @alias in allowlisted id fields with temp ids', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        {
          as: 'topic',
          action: 'write.bullet',
          input: { parent_id: 'p1', text: 'hello' },
        },
        {
          action: 'rem.updateText',
          input: { rem_id: '@topic', text: 'world' },
        },
      ],
    });

    const compiled = compileWritePlanV1(plan, { makeTempId: () => 'tmp:topic' });
    expect(compiled.ops).toHaveLength(2);
    expect(compiled.ops[1]!.type).toBe('update_text');
    expect(compiled.ops[1]!.payload.rem_id).toBe('tmp:topic');
  });

  it('rejects @alias in non-allowlisted fields', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        { as: 'a', action: 'write.bullet', input: { parent_id: 'p1', text: 'hello' } },
        { action: 'write.md.single', input: { parent_id: 'p1', markdown: '@a' } },
      ],
    });

    expect(() => compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' })).toThrow(/not allowed/i);
  });

  it('rejects unknown alias references', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [{ action: 'rem.updateText', input: { rem_id: '@missing', text: 'x' } }],
    });

    expect(() => compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' })).toThrow(/unknown alias/i);
  });

  it('rejects duplicate aliases', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        { as: 'a', action: 'write.bullet', input: { parent_id: 'p1', text: 'hello' } },
        { as: 'a', action: 'write.bullet', input: { parent_id: 'p1', text: 'hello' } },
      ],
    });

    expect(() => compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' })).toThrow(/duplicate alias/i);
  });

  it('rejects using as with actions that do not support it', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [{ as: 'a', action: 'write.md', input: { parent_id: 'p1', markdown: 'hi' } }],
    });

    expect(() => compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' })).toThrow(/does not support/i);
  });

  it('passes backup policy and fixed assertions through rem.children.replace', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        {
          action: 'rem.children.replace',
          input: {
            rem_id: 'parent-1',
            markdown: '- Report',
            backup: 'visible',
            assertions: ['single-root', 'preserve-anchor'],
          },
        },
      ],
    });

    const compiled = compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' });
    expect(compiled.ops).toHaveLength(1);
    expect(compiled.ops[0]!.type).toBe('replace_children_with_markdown');
    expect(compiled.ops[0]!.payload.backup).toBe('visible');
    expect(compiled.ops[0]!.payload.assertions).toEqual(['single-root', 'preserve-anchor']);
  });

  it('rejects invalid assertions in rem.children.replace at compile time', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        {
          action: 'rem.children.replace',
          input: {
            rem_id: 'parent-1',
            markdown: '- Report',
            assertions: ['single-root', 'not-real'],
          },
        },
      ],
    });

    expect(() => compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' })).toThrow(/input\.assertions/i);
  });

  it('rejects preserve-anchor for rem.replace surface=self during compilation', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        {
          action: 'rem.replace',
          input: {
            surface: 'self',
            rem_ids: ['r1', 'r2'],
            markdown: '- Root',
            assertions: ['preserve-anchor'],
          },
        },
      ],
    });

    expect(() => compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' })).toThrow(/preserve-anchor/i);
  });

  it('compiles rem.moveMany into a single move_rem_bulk op', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        {
          action: 'rem.moveMany',
          input: {
            rem_ids: ['r1', 'r2', 'r3'],
            new_parent_id: 'parent-2',
            position: 0,
          },
        },
      ],
    });

    const compiled = compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' });
    expect(compiled.ops).toEqual([
      {
        type: 'move_rem_bulk',
        payload: {
          rem_ids: ['r1', 'r2', 'r3'],
          new_parent_id: 'parent-2',
          position: 0,
        },
      },
    ]);
  });

  it('compiles portal.createMany into a single create_portal_bulk op', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        {
          action: 'portal.createMany',
          input: {
            parent_id: 'parent-2',
            items: [{ target_rem_id: 'r1' }, { target_rem_id: 'r2', position: 2 }],
          },
        },
      ],
    });

    const compiled = compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' });
    expect(compiled.ops).toEqual([
      {
        type: 'create_portal_bulk',
        payload: {
          parent_id: 'parent-2',
          items: [{ target_rem_id: 'r1' }, { target_rem_id: 'r2', position: 2 }],
        },
      },
    ]);
  });

  it('compiles todo.setStatusMany into a single set_todo_status_bulk op', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        {
          action: 'todo.setStatusMany',
          input: {
            items: [
              { rem_id: 'r1', status: 'finished' },
              { rem_id: 'r2', status: 'finished' },
            ],
          },
        },
      ],
    });

    const compiled = compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' });
    expect(compiled.ops).toEqual([
      {
        type: 'set_todo_status_bulk',
        payload: {
          items: [
            { rem_id: 'r1', status: 'finished' },
            { rem_id: 'r2', status: 'finished' },
          ],
        },
      },
    ]);
  });

  it('compiles source.addMany into a single add_source_bulk op', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        {
          action: 'source.addMany',
          input: {
            items: [
              { rem_id: 'r1', source_id: 's1' },
              { rem_id: 'r2', source_id: 's1' },
            ],
          },
        },
      ],
    });

    const compiled = compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' });
    expect(compiled.ops).toEqual([
      {
        type: 'add_source_bulk',
        payload: {
          items: [
            { rem_id: 'r1', source_id: 's1' },
            { rem_id: 'r2', source_id: 's1' },
          ],
        },
      },
    ]);
  });

  it('compiles source.removeMany into a single remove_source_bulk op', () => {
    const plan = parseWritePlanV1({
      version: 1,
      steps: [
        {
          action: 'source.removeMany',
          input: {
            items: [
              { rem_id: 'r1', source_id: 's1' },
              { rem_id: 'r2', source_id: 's1' },
            ],
          },
        },
      ],
    });

    const compiled = compileWritePlanV1(plan, { makeTempId: () => 'tmp:1' });
    expect(compiled.ops).toEqual([
      {
        type: 'remove_source_bulk',
        payload: {
          items: [
            { rem_id: 'r1', source_id: 's1' },
            { rem_id: 'r2', source_id: 's1' },
          ],
        },
      },
    ]);
  });

  it('classifies single-root markdown as outline-suitable', () => {
    expect(decideOutlineWriteShape({ markdown: '- Report\n  - detail' })).toEqual({
      shape: 'single_root_outline',
      outline_suitable: true,
      top_level_roots: 1,
    });
  });

  it('classifies preserve-anchor writes as expand_in_place', () => {
    expect(decideOutlineWriteShape({ markdown: '- Report', preserveAnchor: true })).toEqual({
      shape: 'expand_in_place',
      outline_suitable: true,
      top_level_roots: 0,
    });
  });

  it('classifies prose-like content as normal writing', () => {
    expect(decideOutlineWriteShape({ markdown: 'This is a paragraph.\nIt should stay normal.' })).toEqual({
      shape: 'normal',
      outline_suitable: false,
      top_level_roots: 0,
    });
  });

  it('does not misclassify uniformly indented multi-root markdown as single-root', () => {
    expect(decideOutlineWriteShape({ markdown: '  - Root A\n  - Root B' })).toEqual({
      shape: 'normal',
      outline_suitable: false,
      top_level_roots: 2,
    });
  });
});
