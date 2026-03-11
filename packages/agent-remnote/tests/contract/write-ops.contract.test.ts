import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: write ops --dry-run --json', () => {
  it('prints ok envelope and does not require queue db', async () => {
    const payload = '{"version":1,"kind":"ops","ops":[{"type":"create_rem","payload":{"fooBar":1}}]}';

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.dry_run).toBe(true);
    expect(Array.isArray(parsed.data.ops)).toBe(true);
    expect(parsed.data.ops[0].type).toBe('create_rem');
    expect(parsed.data.ops[0].payload.foo_bar).toBe(1);
  });

  it('accepts object payload with meta (and normalizes keys)', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'ops',
      ops: [{ type: 'create_rem', payload: { fooBar: 1 } }],
      meta: { traceId: 't1', fooBar: 2 },
      clientId: 'test-client',
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.dry_run).toBe(true);
    expect(parsed.data.meta.trace_id).toBe('t1');
    expect(parsed.data.meta.foo_bar).toBe(2);
  });
});
