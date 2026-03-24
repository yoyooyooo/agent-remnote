import { describe, expect, it } from 'vitest';

import { startJsonApiStub } from '../helpers/httpApiStub.js';
import { runCli } from '../helpers/runCli.js';

function buildScenarioPackage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recent_todos_to_today',
    version: 1,
    meta: {
      title: 'Recent todos to today',
      owner: 'user',
      description: 'Collect recent todos and send them to today',
    },
    vars: {
      source_scope: {
        type: 'scope',
        default: 'daily:last-7d',
      },
      target_ref: {
        type: 'ref',
        default: 'daily:today',
      },
    },
    nodes: [
      {
        id: 'recent_todos',
        kind: 'selector',
        selector_kind: 'query',
        input: {
          query: {
            version: 2,
            root: {
              type: 'powerup',
              powerup: {
                by: 'id',
                value: 'todo-powerup-id',
              },
            },
          },
        },
      },
      {
        id: 'deliver',
        kind: 'action',
        depends_on: ['recent_todos'],
        command_id: 'portal.create',
        input: {
          selection: {
            kind: 'node_output',
            node: 'recent_todos',
            output: 'selection',
          },
          target_ref: {
            kind: 'var',
            name: 'target_ref',
          },
        },
      },
    ],
    entry: ['recent_todos'],
    outputs: ['deliver'],
    policy: {
      wait: false,
      remote_parity_required: true,
      max_items: 200,
      idempotency: 'per_run',
    },
    capabilities: {
      requires: ['write_runtime'],
    },
    ...overrides,
  };
}

describe('cli contract: scenario schema', () => {
  it('prints scenario schema help with the tooling subcommands', async () => {
    const res = await runCli(['scenario', 'schema', '--help']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    expect(res.stdout).toContain('validate');
    expect(res.stdout).toContain('normalize');
    expect(res.stdout).toContain('explain');
    expect(res.stdout).toContain('generate');
  });

  it('validates a canonical package and returns the stable tooling envelope', async () => {
    const res = await runCli([
      '--json',
      'scenario',
      'schema',
      'validate',
      '--spec',
      JSON.stringify(buildScenarioPackage()),
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toMatchObject({
      tool: 'scenario.schema',
      subcommand: 'validate',
      schema_version: 1,
      ok: true,
      errors: [],
      warnings: [],
      hints: [],
    });
    expect(Array.isArray(parsed.data.diagnostics)).toBe(true);
  });

  it('normalizes default output slots for selector and action nodes', async () => {
    const res = await runCli([
      '--json',
      'scenario',
      'schema',
      'normalize',
      '--spec',
      JSON.stringify(buildScenarioPackage()),
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.subcommand).toBe('normalize');
    expect(parsed.data.normalized_package.nodes[0].output_slots).toEqual(['selection']);
    expect(parsed.data.normalized_package.nodes[1].output_slots).toEqual(['receipt']);
    expect(parsed.data.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'nodes[0].output_slots', kind: 'defaulted' }),
        expect.objectContaining({ path: 'nodes[1].output_slots', kind: 'defaulted' }),
      ]),
    );
  });

  it('explains selector and action previews with bound vars', async () => {
    const res = await runCli([
      '--json',
      'scenario',
      'schema',
      'explain',
      '--spec',
      JSON.stringify(buildScenarioPackage()),
      '--var',
      'target_ref=daily:tomorrow',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toMatchObject({
      tool: 'scenario.schema',
      subcommand: 'explain',
      ok: true,
    });
    expect(parsed.data.summary).toContain('recent_todos_to_today');
    expect(parsed.data.required_vars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'source_scope' }),
        expect.objectContaining({ name: 'target_ref' }),
      ]),
    );
    expect(parsed.data.selector_preview).toEqual(
      expect.arrayContaining([expect.objectContaining({ node_id: 'recent_todos', selector_kind: 'query' })]),
    );
    expect(parsed.data.action_preview).toEqual(
      expect.arrayContaining([expect.objectContaining({ node_id: 'deliver', command_id: 'portal.create' })]),
    );
    expect(parsed.data.execution_outline).toEqual(
      expect.arrayContaining([expect.stringContaining('recent_todos -> deliver')]),
    );
  });

  it('generates a canonical package from ScenarioGenerateHintV1', async () => {
    const hint = {
      goal: 'Collect recent DN todos into today with a portal',
      selector_kind: 'query',
      action_kind: 'portal.create',
      source_scope: 'daily:last-7d',
      target_ref: 'daily:today',
      vars: [
        {
          name: 'delivery_mode',
          type: 'string',
          default: 'portal',
        },
      ],
      constraints: ['keep-root-results'],
      capabilities: ['requires.write_runtime'],
    };

    const res = await runCli([
      '--json',
      'scenario',
      'schema',
      'generate',
      '--hint',
      JSON.stringify(hint),
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.generated_package.meta.title).toContain('Collect recent DN todos');
    expect(parsed.data.generated_package.nodes).toHaveLength(2);
    expect(parsed.data.generated_package.nodes[0]).toMatchObject({
      kind: 'selector',
      selector_kind: 'query',
    });
    expect(parsed.data.generated_package.nodes[1]).toMatchObject({
      kind: 'action',
      command_id: 'portal.create',
    });
    expect(parsed.data.inputs_used).toMatchObject({
      selector_kind: 'query',
      action_kind: 'portal.create',
    });
  });

  it('rejects free-text generate input because --hint must be structured JSON', async () => {
    const res = await runCli(['--json', 'scenario', 'schema', 'generate', '--hint', 'collect recent todos']);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_PAYLOAD');
  });

  it('keeps scenario schema tooling local even when apiBaseUrl is configured', async () => {
    const api = await startJsonApiStub(() => ({
      payload: { ok: false, error: { code: 'SHOULD_NOT_BE_CALLED', message: 'unexpected request' } },
    }));

    try {
      const res = await runCli([
        '--json',
        '--api-base-url',
        api.baseUrl,
        'scenario',
        'schema',
        'validate',
        '--spec',
        JSON.stringify(buildScenarioPackage()),
      ]);

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(api.requests).toHaveLength(0);
    } finally {
      await api.close();
    }
  });

  it('rejects the removed --package flag', async () => {
    const res = await runCli([
      '--json',
      'scenario',
      'schema',
      'validate',
      '--package',
      JSON.stringify(buildScenarioPackage()),
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
  });
});
