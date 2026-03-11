import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: rem children markdown trimming', () => {
  it('trims boundary blank lines for rem children append (dry-run)', async () => {
    const md = '\n\n- root\n  - child\n\n';
    const res = await runCli(
      ['--json', 'rem', 'children', 'append', '--rem', 'PARENT_ID', '--markdown', md, '--dry-run'],
      { env: { REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
    );

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.dry_run).toBe(true);
    expect(parsed.data?.ops?.[0]?.type).toBe('create_tree_with_markdown');
    expect(parsed.data?.ops?.[0]?.payload?.parent_id).toBe('PARENT_ID');
    expect(parsed.data?.ops?.[0]?.payload?.markdown).toBe('- root\n  - child');
  });

  it('keeps explicit id references during dry-run compilation', async () => {
    const md = '- ((ABCDEF12345678901))\n';
    const res = await runCli(
      ['--json', 'rem', 'children', 'append', '--rem', 'PARENT_ID', '--markdown', md, '--dry-run'],
      { env: { REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
    );

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.ops?.[0]?.payload?.markdown).toBe('- ((ABCDEF12345678901))');
  });
});
