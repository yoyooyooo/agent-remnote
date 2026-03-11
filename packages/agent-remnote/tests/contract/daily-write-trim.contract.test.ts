import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

describe('cli contract: daily write trims boundary blank lines', () => {
  it('removes leading/trailing blank lines from payload.text (dry-run)', async () => {
    const text = '\n\nhello\nworld\n\n';
    const res = await runCli(['--json', 'daily', 'write', '--text', text, '--dry-run'], {
      env: { REMNOTE_TMUX_REFRESH: '0' },
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.dry_run).toBe(true);
    expect(parsed.data?.ops?.[0]?.type).toBe('daily_note_write');
    expect(parsed.data?.ops?.[0]?.payload?.text).toBe('hello\nworld');
  });

  it('supports inline markdown via --markdown (dry-run)', async () => {
    const markdown = '- root\n  - child\n';
    const res = await runCli(['--json', 'daily', 'write', '--markdown', markdown, '--dry-run'], {
      env: { REMNOTE_TMUX_REFRESH: '0' },
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.ops?.[0]?.payload?.markdown).toBe('- root\n  - child');
    expect(parsed.data?.ops?.[0]?.payload?.text).toBeUndefined();
  });

  it('supports markdown from stdin via --markdown - (dry-run)', async () => {
    const res = await runCli(['--json', 'daily', 'write', '--markdown', '-', '--dry-run'], {
      env: { REMNOTE_TMUX_REFRESH: '0' },
      stdin: '\n- root\n  - child\n\n',
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.ops?.[0]?.payload?.markdown).toBe('- root\n  - child');
  });

  it('rejects markdown-like content passed to --text', async () => {
    const res = await runCli(['--json', 'daily', 'write', '--text', '- root\n  - child', '--dry-run'], {
      env: { REMNOTE_TMUX_REFRESH: '0' },
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.message ?? '').toContain('looks like structured Markdown');
  });

  it('allows markdown-like content passed to --text when --force-text is set', async () => {
    const res = await runCli(['--json', 'daily', 'write', '--text', '- root\n  - child', '--force-text', '--dry-run'], {
      env: { REMNOTE_TMUX_REFRESH: '0' },
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.ops?.[0]?.payload?.text).toBe('- root\n  - child');
  });

  it('fails fast for --dry-run --wait before attempting stdin read', async () => {
    const res = await runCli(['--json', 'daily', 'write', '--markdown', '-', '--dry-run', '--wait'], {
      env: { REMNOTE_TMUX_REFRESH: '0' },
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.message ?? '').toContain('--wait is not compatible with --dry-run');
  });

  it('treats empty string text as provided for exclusivity checks', async () => {
    const res = await runCli(['--json', 'daily', 'write', '--text', '', '--markdown', '- root', '--dry-run'], {
      env: { REMNOTE_TMUX_REFRESH: '0' },
      timeoutMs: 15_000,
    });

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.message ?? '').toContain('Choose only one of --text or --markdown');
  });
});
