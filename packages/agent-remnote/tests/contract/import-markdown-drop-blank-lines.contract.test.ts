import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: import markdown drops blank lines outside fences', () => {
  it('removes internal blank lines from payload.markdown (dry-run) but preserves fenced code blank lines', async () => {
    const md = ['## A', '', '### B', '- x', '', '- y', '```', '', 'code', '', '```', ''].join('\n');
    const res = await runCli(
      ['--json', 'import', 'markdown', '--parent', 'PARENT_ID', '--markdown', md, '--dry-run'],
      { env: { REMNOTE_TMUX_REFRESH: '0' }, timeoutMs: 15_000 },
    );

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.dry_run).toBe(true);
    expect(parsed.data?.ops?.[0]?.type).toBe('create_tree_with_markdown');
    expect(parsed.data?.ops?.[0]?.payload?.markdown).toBe('## A\n### B\n- x\n- y\n```\n\ncode\n\n```');
  });
});

