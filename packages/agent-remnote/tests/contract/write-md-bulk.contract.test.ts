import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

function buildLargeMarkdown(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `- item ${i + 1}`).join('\n');
}

describe('cli contract: write md bulk bundling', () => {
  it('auto-bundles large markdown by default (dry-run)', async () => {
    const md = buildLargeMarkdown(81);
    const res = await runCli([
      '--json',
      'import',
      'markdown',
      '--parent',
      'dummy-parent',
      '--markdown',
      md,
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.dry_run).toBe(true);
    expect(parsed.data.ops).toHaveLength(1);

    const op = parsed.data.ops[0];
    expect(op.type).toBe('create_tree_with_markdown');
    expect(op.payload.markdown).toBe(md);

    expect(op.payload.bundle).toEqual({
      enabled: true,
      title: `Imported (bundle) (${md.split('\n').length} lines, ${md.length} chars)`,
    });
  });

  it('can disable bundling with --bulk=never (dry-run)', async () => {
    const md = buildLargeMarkdown(81);
    const res = await runCli([
      '--json',
      'import',
      'markdown',
      '--parent',
      'dummy-parent',
      '--markdown',
      md,
      '--bulk',
      'never',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);

    const op = parsed.data.ops[0];
    expect(op.type).toBe('create_tree_with_markdown');
    expect(op.payload.bundle).toBeUndefined();
  });
});
