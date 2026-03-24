import { describe, expect, it } from 'vitest';

import { normalizeScenarioPackage, validateScenarioPackage } from '../../src/lib/scenario-shared/index.js';

describe('scenario schema shared logic', () => {
  it('fills default output slots during normalization', () => {
    const normalized = normalizeScenarioPackage({
      id: 'recent_todos_to_today',
      version: 1,
      meta: {
        title: 'Recent todos to today',
        owner: 'user',
      },
      vars: {},
      nodes: [
        {
          id: 'recent_todos',
          kind: 'selector',
          selector_kind: 'query',
          input: { query: { version: 2, root: { type: 'text', value: 'todo' } } },
        },
        {
          id: 'deliver',
          kind: 'action',
          depends_on: ['recent_todos'],
          command_id: 'portal.create',
          input: {
            selection: { kind: 'node_output', node: 'recent_todos', output: 'selection' },
          },
        },
      ],
      entry: ['recent_todos'],
      outputs: ['deliver'],
      policy: {
        wait: false,
        remote_parity_required: true,
        max_items: 50,
        idempotency: 'per_run',
      },
      capabilities: {},
    });

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      throw new Error(`Expected normalization success, received errors: ${normalized.errors.join(', ')}`);
    }
    expect(normalized.package.nodes[0]?.output_slots).toEqual(['selection']);
    expect(normalized.package.nodes[1]?.output_slots).toEqual(['receipt']);
  });

  it('reports invalid node_output references', () => {
    const result = validateScenarioPackage({
      id: 'broken_package',
      version: 1,
      meta: {
        title: 'Broken package',
        owner: 'user',
      },
      vars: {},
      nodes: [
        {
          id: 'recent_todos',
          kind: 'selector',
          selector_kind: 'query',
          input: { query: { version: 2, root: { type: 'text', value: 'todo' } } },
          output_slots: ['selection'],
        },
        {
          id: 'deliver',
          kind: 'action',
          depends_on: ['recent_todos'],
          command_id: 'portal.create',
          input: {
            selection: { kind: 'node_output', node: 'recent_todos', output: 'missing_slot' },
          },
          output_slots: ['receipt'],
        },
      ],
      entry: ['recent_todos'],
      outputs: ['deliver'],
      policy: {
        wait: false,
        remote_parity_required: true,
        max_items: 50,
        idempotency: 'per_run',
      },
      capabilities: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('missing_slot')]));
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'nodes[1].input.selection.output' })]),
    );
  });

  it('preserves scheduling hints during normalization', () => {
    const normalized = normalizeScenarioPackage({
      id: 'recent_todos_to_today',
      version: 1,
      meta: {
        title: 'Recent todos to today',
        owner: 'user',
      },
      vars: {},
      nodes: [
        {
          id: 'recent_todos',
          kind: 'selector',
          selector_kind: 'query',
          input: { query: { version: 2, root: { type: 'text', value: 'todo' } } },
        },
      ],
      entry: ['recent_todos'],
      outputs: ['recent_todos.selection'],
      policy: {
        wait: false,
        remote_parity_required: true,
        max_items: 50,
      },
      scheduling: {
        batching: 'auto',
        merge_strategy: 'safe_dedupe',
        parallelism: 'auto',
        ordering: 'preserve_selection_order',
        dispatch_mode: 'conflict_parallel',
      },
      capabilities: {},
    });

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) throw new Error(normalized.errors.join(', '));
    expect(normalized.package.scheduling).toEqual({
      batching: 'auto',
      merge_strategy: 'safe_dedupe',
      parallelism: 'auto',
      ordering: 'preserve_selection_order',
      dispatch_mode: 'conflict_parallel',
    });
  });
});
