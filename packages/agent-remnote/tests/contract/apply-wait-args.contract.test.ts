import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: apply wait args', () => {
  it('rejects timeout args without --wait', async () => {
    const payload = '{"version":1,"kind":"ops","ops":[{"type":"delete_rem","payload":{"rem_id":"dummy"}}]}';
    const res = await runCli(['--json', 'apply', '--timeout-ms', '1000', '--payload', payload]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe('INVALID_ARGS');
    expect(parsed.error?.message).toContain('Use --wait');
  });

  it('rejects --dry-run with --wait', async () => {
    const payload = '{"version":1,"kind":"ops","ops":[{"type":"delete_rem","payload":{"rem_id":"dummy"}}]}';
    const res = await runCli(['--json', 'apply', '--dry-run', '--wait', '--payload', payload]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe('INVALID_ARGS');
    expect(parsed.error?.message).toContain('not compatible');
  });
});
