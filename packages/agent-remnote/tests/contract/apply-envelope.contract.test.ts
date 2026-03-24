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

  it('silently coalesces consecutive rem.move actions into move_rem_bulk on dry-run', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { action: 'rem.move', input: { rem_id: 'RID-1', new_parent_id: 'P-2' } },
        { action: 'rem.move', input: { rem_id: 'RID-2', new_parent_id: 'P-2' } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.kind).toBe('actions');
    expect(parsed.data.ops).toEqual([
      {
        type: 'move_rem_bulk',
        payload: {
          rem_ids: ['RID-1', 'RID-2'],
          new_parent_id: 'P-2',
        },
      },
    ]);
  });

  it('silently coalesces consecutive portal.create actions into create_portal_bulk on dry-run', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { action: 'portal.create', input: { parent_id: 'P-1', target_rem_id: 'RID-1' } },
        { action: 'portal.create', input: { parent_id: 'P-1', target_rem_id: 'RID-2', position: 2 } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.kind).toBe('actions');
    expect(parsed.data.ops).toEqual([
      {
        type: 'create_portal_bulk',
        payload: {
          parent_id: 'P-1',
          items: [{ target_rem_id: 'RID-1' }, { target_rem_id: 'RID-2', position: 2 }],
        },
      },
    ]);
  });

  it('keeps rem.move scalar when alias references are involved', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { as: 'a', action: 'write.bullet', input: { parent_id: 'P-1', text: 'hello' } },
        { action: 'rem.move', input: { rem_id: '@a', new_parent_id: 'P-2' } },
        { action: 'rem.move', input: { rem_id: 'RID-2', new_parent_id: 'P-2' } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops.map((op: any) => op.type)).toEqual(['create_rem', 'move_rem', 'move_rem']);
  });

  it('keeps portal.create scalar when positions are heterogeneous in a conflicting way', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { action: 'portal.create', input: { parent_id: 'P-1', target_rem_id: 'RID-1', position: 0 } },
        { action: 'portal.create', input: { parent_id: 'P-2', target_rem_id: 'RID-2', position: 0 } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops).toEqual([
      {
        type: 'create_portal',
        payload: { parent_id: 'P-1', target_rem_id: 'RID-1', position: 0 },
      },
      {
        type: 'create_portal',
        payload: { parent_id: 'P-2', target_rem_id: 'RID-2', position: 0 },
      },
    ]);
  });

  it('silently coalesces consecutive tag.add actions into add_tag_bulk on dry-run', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { action: 'tag.add', input: { rem_id: 'RID-1', tag_id: 'T-1' } },
        { action: 'tag.add', input: { rem_id: 'RID-2', tag_id: 'T-1' } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops).toEqual([
      {
        type: 'add_tag_bulk',
        payload: {
          items: [
            { rem_id: 'RID-1', tag_id: 'T-1' },
            { rem_id: 'RID-2', tag_id: 'T-1' },
          ],
        },
      },
    ]);
  });

  it('silently coalesces consecutive tag.remove actions into remove_tag_bulk on dry-run', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { action: 'tag.remove', input: { rem_id: 'RID-1', tag_id: 'T-1', remove_properties: true } },
        { action: 'tag.remove', input: { rem_id: 'RID-2', tag_id: 'T-1', remove_properties: true } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops).toEqual([
      {
        type: 'remove_tag_bulk',
        payload: {
          items: [
            { rem_id: 'RID-1', tag_id: 'T-1' },
            { rem_id: 'RID-2', tag_id: 'T-1' },
          ],
          remove_properties: true,
        },
      },
    ]);
  });

  it('silently coalesces consecutive todo.setStatus actions into set_todo_status_bulk on dry-run', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { action: 'todo.setStatus', input: { rem_id: 'RID-1', status: 'finished' } },
        { action: 'todo.setStatus', input: { rem_id: 'RID-2', status: 'finished' } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops).toEqual([
      {
        type: 'set_todo_status_bulk',
        payload: {
          items: [
            { rem_id: 'RID-1', status: 'finished' },
            { rem_id: 'RID-2', status: 'finished' },
          ],
        },
      },
    ]);
  });

  it('silently coalesces consecutive todo.setStatus actions even when statuses differ', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { action: 'todo.setStatus', input: { rem_id: 'RID-1', status: 'open' } },
        { action: 'todo.setStatus', input: { rem_id: 'RID-2', status: 'finished' } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops).toEqual([
      {
        type: 'set_todo_status_bulk',
        payload: {
          items: [
            { rem_id: 'RID-1', status: 'open' },
            { rem_id: 'RID-2', status: 'finished' },
          ],
        },
      },
    ]);
  });

  it('silently coalesces consecutive source.add actions into add_source_bulk on dry-run', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { action: 'source.add', input: { rem_id: 'RID-1', source_id: 'SRC-1' } },
        { action: 'source.add', input: { rem_id: 'RID-2', source_id: 'SRC-1' } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops).toEqual([
      {
        type: 'add_source_bulk',
        payload: {
          items: [
            { rem_id: 'RID-1', source_id: 'SRC-1' },
            { rem_id: 'RID-2', source_id: 'SRC-1' },
          ],
        },
      },
    ]);
  });

  it('silently coalesces consecutive source.add actions even when source ids differ', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { action: 'source.add', input: { rem_id: 'RID-1', source_id: 'SRC-1' } },
        { action: 'source.add', input: { rem_id: 'RID-2', source_id: 'SRC-2' } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops).toEqual([
      {
        type: 'add_source_bulk',
        payload: {
          items: [
            { rem_id: 'RID-1', source_id: 'SRC-1' },
            { rem_id: 'RID-2', source_id: 'SRC-2' },
          ],
        },
      },
    ]);
  });

  it('silently coalesces consecutive source.remove actions into remove_source_bulk on dry-run', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { action: 'source.remove', input: { rem_id: 'RID-1', source_id: 'SRC-1' } },
        { action: 'source.remove', input: { rem_id: 'RID-2', source_id: 'SRC-1' } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops).toEqual([
      {
        type: 'remove_source_bulk',
        payload: {
          items: [
            { rem_id: 'RID-1', source_id: 'SRC-1' },
            { rem_id: 'RID-2', source_id: 'SRC-1' },
          ],
        },
      },
    ]);
  });

  it('silently coalesces consecutive source.remove actions even when source ids differ', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        { action: 'source.remove', input: { rem_id: 'RID-1', source_id: 'SRC-1' } },
        { action: 'source.remove', input: { rem_id: 'RID-2', source_id: 'SRC-2' } },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');
    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.ops).toEqual([
      {
        type: 'remove_source_bulk',
        payload: {
          items: [
            { rem_id: 'RID-1', source_id: 'SRC-1' },
            { rem_id: 'RID-2', source_id: 'SRC-2' },
          ],
        },
      },
    ]);
  });
});
