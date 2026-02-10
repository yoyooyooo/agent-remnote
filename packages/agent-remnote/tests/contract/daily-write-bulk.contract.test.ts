import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

function buildLargeText(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n');
}

describe('cli contract: write daily bulk bundling', () => {
  it('auto-bundles large text by default (dry-run)', async () => {
    const text = buildLargeText(81);
    const res = await runCli(['--json', 'daily', 'write', '--text', text, '--dry-run']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.dry_run).toBe(true);
    expect(parsed.data.ops).toHaveLength(1);

    const op = parsed.data.ops[0];
    expect(op.type).toBe('daily_note_write');

    expect(op.payload.bundle).toEqual({
      enabled: true,
      title: 'Imported (bundle)',
    });
  });

  it('can disable bundling with --bulk=never (dry-run)', async () => {
    const text = buildLargeText(81);
    const res = await runCli(['--json', 'daily', 'write', '--text', text, '--bulk', 'never', '--dry-run']);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);

    const op = parsed.data.ops[0];
    expect(op.type).toBe('daily_note_write');
    expect(op.payload.bundle).toBeUndefined();
  });
});
