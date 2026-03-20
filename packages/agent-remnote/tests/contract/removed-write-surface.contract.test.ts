import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: removed write surfaces fail fast', () => {
  it('rejects import markdown', async () => {
    const res = await runCli(['--json', 'import', 'markdown', '--file', 'note.md'], { timeoutMs: 15_000 });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout) as any;
    expect(parsed.ok).toBe(false);
  });

  it('rejects plan apply', async () => {
    const res = await runCli(['--json', 'plan', 'apply', '--payload', '{}'], { timeoutMs: 15_000 });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout) as any;
    expect(parsed.ok).toBe(false);
  });

  it('rejects write wechat outline', async () => {
    const res = await runCli(['--json', 'write', 'wechat', 'outline', '--payload', '{}'], { timeoutMs: 15_000 });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout) as any;
    expect(parsed.ok).toBe(false);
  });
});
