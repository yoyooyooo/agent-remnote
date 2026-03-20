import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: canonical apply envelope', () => {
  it('accepts kind=actions through apply --payload in dry-run mode', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [{ action: 'write.bullet', input: { parent_id: 'p1', text: 'hello' } }],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.kind).toBe('actions');
    expect(parsed.data.ops[0].type).toBe('create_rem');
  });

  it('accepts kind=ops through apply --payload in dry-run mode', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'ops',
      ops: [{ type: 'delete_rem', payload: { rem_id: 'RID-1' } }],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.kind).toBe('ops');
    expect(parsed.data.ops[0].type).toBe('delete_rem');
  });

  it('rejects empty action envelopes', async () => {
    const payload = JSON.stringify({ version: 1, kind: 'actions', actions: [] });
    const res = await runCli(['--json', 'apply', '--payload', payload]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_PAYLOAD');
  });
});
