import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: rem create text guard', () => {
  it('rejects markdown-like content passed to --text', async () => {
    const res = await runCli(
      ['--json', 'rem', 'create', '--at', 'parent:id:PARENT', '--text', '- root\n  - child', '--dry-run'],
      {
        env: { REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 15_000,
      },
    );

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.message ?? '').toContain('looks like structured Markdown');
  });

  it('allows markdown-like text when --force-text is set', async () => {
    const res = await runCli(
      ['--json', 'rem', 'create', '--at', 'parent:id:PARENT', '--text', '- root\n  - child', '--force-text', '--dry-run'],
      {
        env: { REMNOTE_TMUX_REFRESH: '0' },
        timeoutMs: 15_000,
      },
    );

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.ops?.[0]?.payload?.text).toBe('- root\n  - child');
  });
});
