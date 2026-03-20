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

describe('cli contract: canonical apply envelope', () => {
  it('accepts kind=actions through apply --payload in dry-run mode', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [{ action: 'write.bullet', input: { parent_id: 'p1', text: 'hello' } }],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.kind).toBe('actions');
    expect(parsed.data.ops[0].type).toBe('create_rem');
  });

  it('accepts kind=ops through apply --payload in dry-run mode', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'ops',
      ops: [{ type: 'delete_rem', payload: { rem_id: 'RID-1' } }],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.kind).toBe('ops');
    expect(parsed.data.ops[0].type).toBe('delete_rem');
  });

  it('expands @file for markdown fields in action envelopes', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-apply-md-action-'));
    const notePath = path.join(tmpDir, 'note.md');

    try {
      await fs.writeFile(notePath, '\n- root\n  - child\n', 'utf8');
      const payload = JSON.stringify({
        version: 1,
        kind: 'actions',
        actions: [{ action: 'rem.children.append', input: { rem_id: 'RID-1', markdown: `@${notePath}` } }],
      });

      const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.kind).toBe('actions');
      expect(parsed.data.ops[0].type).toBe('create_tree_with_markdown');
      expect(parsed.data.ops[0].payload.markdown).toBe('- root\n  - child');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('expands @file for markdown fields in ops envelopes', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-apply-md-op-'));
    const notePath = path.join(tmpDir, 'note.md');

    try {
      await fs.writeFile(notePath, '\n- root\n  - child\n', 'utf8');
      const payload = JSON.stringify({
        version: 1,
        kind: 'ops',
        ops: [{ type: 'create_tree_with_markdown', payload: { parent_id: 'RID-1', markdown: `@${notePath}` } }],
      });

      const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload], {
        timeoutMs: 15_000,
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const parsed = parseJsonLine(res.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.kind).toBe('ops');
      expect(parsed.data.ops[0].type).toBe('create_tree_with_markdown');
      expect(parsed.data.ops[0].payload.markdown).toBe('- root\n  - child');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects empty action envelopes', async () => {
    const payload = JSON.stringify({ version: 1, kind: 'actions', actions: [] });
    const res = await runCli(['--json', 'apply', '--payload', payload]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('INVALID_PAYLOAD');
  });
});
