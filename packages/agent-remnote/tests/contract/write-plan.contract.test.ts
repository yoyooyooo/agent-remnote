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
});
