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

  it.each([
    ['rem create legacy target source', ['--json', 'rem', 'create', '--target', 'r1', '--at', 'standalone', '--dry-run']],
    ['rem create legacy parent flag', ['--json', 'rem', 'create', '--text', 'hello', '--parent', 'p1', '--dry-run']],
    ['rem move legacy rem flag', ['--json', 'rem', 'move', '--rem', 'r1', '--at', 'standalone', '--dry-run']],
    ['rem move legacy leave-portal flag', ['--json', 'rem', 'move', '--subject', 'id:r1', '--at', 'standalone', '--leave-portal', '--dry-run']],
    ['portal create legacy target flag', ['--json', 'portal', 'create', '--target', 't1', '--at', 'parent:id:p1', '--dry-run']],
    ['portal create legacy parent flag', ['--json', 'portal', 'create', '--to', 'id:t1', '--parent', 'p1', '--dry-run']],
    ['rem set-text legacy rem flag', ['--json', 'rem', 'set-text', '--rem', 'r1', '--text', 'hello', '--dry-run']],
    ['rem children append legacy rem flag', ['--json', 'rem', 'children', 'append', '--rem', 'r1', '--markdown', '- child', '--dry-run']],
    ['tag add legacy rem flag', ['--json', 'tag', 'add', '--rem', 'r1', '--tag', 't1', '--dry-run']],
    ['tag add legacy subject flag', ['--json', 'tag', 'add', '--subject', 'r1', '--tag', 't1', '--dry-run']],
  ])('rejects %s', async (_label, argv) => {
    const res = await runCli(argv, { timeoutMs: 15_000 });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout) as any;
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe('INVALID_ARGS');
  });
});
