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

describe('cli contract: apply actions envelope', () => {
  it('prints ok envelope for --dry-run --json and keeps stderr empty', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        {
          as: 'a',
          action: 'write.bullet',
          input: { parentId: 'p1', text: 'hello' },
        },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.dry_run).toBe(true);
    expect(Array.isArray(parsed.data?.ops)).toBe(true);
    expect(parsed.data.ops[0].type).toBe('create_rem');
    expect(parsed.data.ops[0].payload.parent_id).toBe('p1');
    expect(String(parsed.data.alias_map.a)).toMatch(/^tmp:/);
    expect(parsed.data.ops[0].payload.client_temp_id).toBe(parsed.data.alias_map.a);
  });

  it('supports enqueue + --ids output (stdout purity) when store db is provided', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const payload = JSON.stringify({
        version: 1,
        kind: 'actions',
        actions: [
          { as: 'a', action: 'write.bullet', input: { parent_id: 'p1', text: 'hello' } },
          { action: 'rem.updateText', input: { rem_id: '@a', text: 'world' } },
          { action: 'tag.add', input: { rem_id: '@a', tag_id: 't1' } },
        ],
      });

      const res = await runCli(['--ids', 'apply', '--payload', payload, '--no-notify', '--no-ensure-daemon'], {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' },
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');

      const lines = res.stdout
        .trim()
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(4);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reuses an existing txn for the same idempotency-key (and keeps alias_map stable)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const payload = JSON.stringify({
        version: 1,
        kind: 'actions',
        actions: [{ as: 'a', action: 'write.bullet', input: { parent_id: 'p1', text: 'hello' } }],
      });

      const args = [
        '--json',
        'apply',
        '--payload',
        payload,
        '--no-notify',
        '--no-ensure-daemon',
        '--idempotency-key',
        'idem:write-plan:test',
      ] as const;

      const res1 = await runCli(args, { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' } });
      expect(res1.exitCode).toBe(0);
      expect(res1.stderr).toBe('');
      const env1 = parseJsonLine(res1.stdout);
      expect(env1.ok).toBe(true);
      const txnId1 = String(env1.data?.txn_id ?? '');
      expect(txnId1).toMatch(/[0-9a-f-]{36}/);
      const aliasMap1 = env1.data?.alias_map;
      expect(typeof aliasMap1?.a).toBe('string');

      const res2 = await runCli(args, { env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' } });
      expect(res2.exitCode).toBe(0);
      expect(res2.stderr).toBe('');
      const env2 = parseJsonLine(res2.stdout);
      expect(env2.ok).toBe(true);
      expect(String(env2.data?.txn_id ?? '')).toBe(txnId1);
      expect(env2.data?.deduped).toBe(true);
      expect(typeof env2.data?.alias_map?.a).toBe('string');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns the real enqueue alias_map for local apply actions', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remnote-cli-test-'));
    const tmpHome = path.join(tmpDir, 'home');
    const storeDb = path.join(tmpDir, 'store.sqlite');

    try {
      const payload = JSON.stringify({
        version: 1,
        kind: 'actions',
        actions: [
          { as: 'parent_alias', action: 'write.bullet', input: { parent_id: 'p1', text: 'parent' } },
          { as: 'target_alias', action: 'write.bullet', input: { parent_id: 'p1', text: 'target' } },
          { action: 'portal.create', input: { parent_id: '@parent_alias', target_rem_id: '@target_alias' } },
        ],
      });

      const res = await runCli(['--json', 'apply', '--payload', payload, '--no-notify', '--no-ensure-daemon'], {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' },
      });

      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      const env = parseJsonLine(res.stdout);
      expect(env.ok).toBe(true);

      const inspect = await runCli(['--json', 'queue', 'inspect', '--txn', String(env.data.txn_id)], {
        env: { HOME: tmpHome, REMNOTE_STORE_DB: storeDb, REMNOTE_TMUX_REFRESH: '0' },
      });

      expect(inspect.exitCode).toBe(0);
      expect(inspect.stderr).toBe('');
      const inspected = parseJsonLine(inspect.stdout);
      expect(inspected.ok).toBe(true);

      const createTempIds = new Set(
        inspected.data.ops.filter((op: any) => op.type === 'create_rem').map((op: any) => op.payload.client_temp_id),
      );
      expect(createTempIds).toEqual(new Set([env.data.alias_map.parent_alias, env.data.alias_map.target_alias]));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('compiles portal.create as a canonical atomic action', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        {
          as: 'a',
          action: 'write.bullet',
          input: { parent_id: 'p1', text: 'hello' },
        },
        {
          action: 'portal.create',
          input: { parent_id: '@a', target_rem_id: 't1', position: 2 },
        },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.dry_run).toBe(true);
    expect(Array.isArray(parsed.data?.ops)).toBe(true);
    expect(parsed.data.ops[1].type).toBe('create_portal');
    expect(parsed.data.ops[1].payload.parent_id).toBe(String(parsed.data.alias_map.a));
    expect(parsed.data.ops[1].payload.target_rem_id).toBe('t1');
    expect(parsed.data.ops[1].payload.position).toBe(2);
  });

  it('allows earlier aliases in portal.create parent_id and target_rem_id', async () => {
    const payload = JSON.stringify({
      version: 1,
      kind: 'actions',
      actions: [
        {
          as: 'parent_anchor',
          action: 'write.bullet',
          input: { parent_id: 'p1', text: 'anchor' },
        },
        {
          as: 'target_rem',
          action: 'write.bullet',
          input: { parent_id: 'p1', text: 'target' },
        },
        {
          action: 'portal.create',
          input: { parent_id: '@parent_anchor', target_rem_id: '@target_rem', position: 1 },
        },
      ],
    });

    const res = await runCli(['--json', 'apply', '--dry-run', '--payload', payload]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const parsed = parseJsonLine(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.dry_run).toBe(true);
    expect(parsed.data.ops[2].type).toBe('create_portal');
    expect(parsed.data.ops[2].payload.parent_id).toBe(String(parsed.data.alias_map.parent_anchor));
    expect(parsed.data.ops[2].payload.target_rem_id).toBe(String(parsed.data.alias_map.target_rem));
    expect(parsed.data.ops[2].payload.position).toBe(1);
  });
});
