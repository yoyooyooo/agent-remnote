import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: markdown input spec', () => {
  it('accepts @file for daily write', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-md-spec-'));
    const notePath = path.join(tmpDir, 'note.md');

    try {
      await fs.writeFile(notePath, '- root\n  - child\n', 'utf8');

      const res = await runCli(['--json', 'daily', 'write', '--markdown', `@${notePath}`, '--dry-run'], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.dry_run).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts @file for rem children append', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-md-spec-'));
    const notePath = path.join(tmpDir, 'note.md');

    try {
      await fs.writeFile(notePath, '- root\n  - child\n', 'utf8');

      const res = await runCli(['--json', 'rem', 'children', 'append', '--rem', 'RID-1', '--markdown', `@${notePath}`, '--dry-run'], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.dry_run).toBe(true);
      expect(parsed.data.ops[0].payload.markdown).toBe('- root\n  - child');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts stdin for rem children append', async () => {
    const res = await runCli(['--json', 'rem', 'children', 'append', '--rem', 'RID-1', '--markdown', '-', '--dry-run'], {
      timeoutMs: 15_000,
      stdin: '\n- root\n  - child\n',
    });

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.dry_run).toBe(true);
    expect(parsed.data.ops[0].payload.markdown).toBe('- root\n  - child');
  });
});
