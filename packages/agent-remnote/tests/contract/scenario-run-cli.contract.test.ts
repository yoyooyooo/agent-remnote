import { describe, expect, it } from 'vitest';

import { startJsonApiStub } from '../helpers/httpApiStub.js';
import { runCli } from '../helpers/runCli.js';

describe('cli contract: scenario run', () => {
  it('accepts the package spec as a positional argument for agent-first routing', async () => {
    const api = await startJsonApiStub((request) => {
      if (request.method === 'POST' && request.url === '/v1/read/query') {
        return {
          payload: {
            ok: true,
            data: {
              totalMatched: 1,
              items: [{ id: 'RID-P1', title: 'Task Positional' }],
            },
          },
        };
      }

      return undefined;
    });

    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'scenario', 'run', 'dn_recent_todos_to_today_move', '--dry-run'],
        { timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.phase).toBe('compiled');
      expect(parsed.data.plan.compiled_execution.envelope.actions).toEqual([
        {
          action: 'rem.move',
          input: {
            rem_id: 'RID-P1',
            new_parent_id: 'daily:today',
          },
        },
      ]);
    } finally {
      await api.close();
    }
  });

  it('runs builtin move package in dry-run mode and keeps daily scope/query canonical', async () => {
    const api = await startJsonApiStub((request) => {
      if (request.method === 'POST' && request.url === '/v1/read/query') {
        return {
          payload: {
            ok: true,
            data: {
              totalMatched: 2,
              items: [
                { id: 'RID-1', title: 'Task 1' },
                { id: 'RID-2', title: 'Task 2' },
              ],
            },
          },
        };
      }

      return undefined;
    });

    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'scenario', 'run', '--package', 'dn_recent_todos_to_today_move', '--dry-run'],
        { timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.phase).toBe('compiled');
      expect(parsed.data.submission).toBeNull();
      expect(parsed.data.plan.compiled_execution.kind).toBe('apply_actions');
      expect(parsed.data.plan.compiled_execution.envelope.actions).toEqual([
        {
          action: 'rem.moveMany',
          input: {
            rem_ids: ['RID-1', 'RID-2'],
            new_parent_id: 'daily:today',
          },
        },
      ]);
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.url).toBe('/v1/read/query');
      expect(api.requests[0]?.body).toMatchObject({
        query: {
          version: 2,
          root: {
            type: 'powerup',
            powerup: {
              by: 'rcrt',
              value: 't',
            },
          },
          scope: {
            kind: 'daily_range',
            from_offset_days: -7,
            to_offset_days: -1,
          },
          shape: {
            roots_only: true,
          },
        },
      });
    } finally {
      await api.close();
    }
  });

  it('runs builtin portal package through remote write.apply when not dry-run', async () => {
    const api = await startJsonApiStub((request) => {
      if (request.method === 'POST' && request.url === '/v1/read/query') {
        return {
          payload: {
            ok: true,
            data: {
              totalMatched: 1,
              items: [{ id: 'RID-9', title: 'Task Portal' }],
            },
          },
        };
      }

      if (request.method === 'POST' && request.url === '/v1/write/apply') {
        return {
          payload: {
            ok: true,
            data: {
              txn_id: 'txn-scenario-1',
              op_ids: ['op-scenario-1'],
              notified: false,
              sent: 1,
            },
          },
        };
      }

      return undefined;
    });

    try {
      const res = await runCli(
        ['--json', '--api-base-url', api.baseUrl, 'scenario', 'run', '--package', 'dn_recent_todos_to_today_portal'],
        { timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.data.phase).toBe('compiled');
      expect(parsed.data.submission).toMatchObject({
        txn_id: 'txn-scenario-1',
        op_ids: ['op-scenario-1'],
      });
      expect(api.requests).toHaveLength(2);
      expect(api.requests[1]?.url).toBe('/v1/write/apply');
      expect(api.requests[1]?.body).toMatchObject({
        version: 1,
        kind: 'actions',
        actions: [
          {
            action: 'portal.create',
            input: {
              parent_id: 'daily:today',
              target_rem_id: 'RID-9',
            },
          },
        ],
      });
    } finally {
      await api.close();
    }
  });

  it('fails fast on invalid source_scope input instead of widening to the whole vault', async () => {
    const api = await startJsonApiStub(() => undefined);

    try {
      const res = await runCli(
        [
          '--json',
          '--api-base-url',
          api.baseUrl,
          'scenario',
          'run',
          '--package',
          'dn_recent_todos_to_today_move',
          '--dry-run',
          '--var',
          'source_scope=daily:typo-range',
        ],
        { timeoutMs: 15_000 },
      );

      expect(res.exitCode).toBe(2);
      expect(res.stderr).toBe('');

      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe('INVALID_ARGS');
      expect(parsed.error.message).toContain('Unsupported scenario scope value');
      expect(api.requests).toHaveLength(0);
    } finally {
      await api.close();
    }
  });
});
