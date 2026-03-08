import { describe, expect, it } from 'vitest';

import { compileWritePlanV1, parseWritePlanV1 } from '../../src/kernel/write-plan/index.js';

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
});
