import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: strict remote mode blocks local-only reads', () => {
  it('rejects db recent when apiBaseUrl is configured', async () => {
    const res = await runCli(['--json', '--api-base-url', 'http://127.0.0.1:9', 'db', 'recent'], {
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
    expect(String(parsed.error.message)).toContain('apiBaseUrl');
  });

  it('rejects table show when apiBaseUrl is configured', async () => {
    const res = await runCli(['--json', '--api-base-url', 'http://127.0.0.1:9', 'table', 'show', '--id', 'tag-1'], {
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
    expect(String(parsed.error.message)).toContain('apiBaseUrl');
  });

  it('rejects daily write when apiBaseUrl is configured', async () => {
    const res = await runCli(
      ['--json', '--api-base-url', 'http://127.0.0.1:9', 'daily', 'write', '--text', 'hello remote'],
      {
        timeoutMs: 15_000,
      },
    );

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_ARGS');
    expect(String(parsed.error.message)).toContain('apiBaseUrl');
    expect(String(parsed.hint?.join(' ') ?? '')).toContain('daily:today');
  });
});
