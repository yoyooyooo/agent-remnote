import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/runCli.js';

function parseJsonLine(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Expected non-empty stdout JSON');
  return JSON.parse(trimmed);
}

describe('cli contract: write command surface reset', () => {
  it('compiles rem create --text with --at parent[position]:ref', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'create',
      '--text',
      'hello',
      '--at',
      'parent[2]:id:PARENT_ID',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.ops?.[0]).toEqual({
      type: 'create_rem',
      payload: {
        text: 'hello',
        parent_id: 'PARENT_ID',
        position: 2,
        client_temp_id: env.data.alias_map.durable_target,
      },
    });
  });

  it('compiles rem move with explicit portal placement', async () => {
    const res = await runCli([
      '--json',
      'rem',
      'move',
      '--subject',
      'id:r1',
      '--at',
      'parent[1]:id:DEST_PARENT',
      '--portal',
      'at:parent:id:PORTAL_PARENT',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(true);
    expect(env.data?.ops).toEqual([
      {
        type: 'move_rem',
        payload: {
          rem_id: 'r1',
          new_parent_id: 'DEST_PARENT',
          position: 1,
        },
      },
      {
        type: 'create_portal',
        payload: {
          parent_id: 'PORTAL_PARENT',
          target_rem_id: 'r1',
          client_temp_id: env.data.alias_map.portal_rem,
        },
      },
    ]);
  });

  it('rejects malformed --at placement specs', async () => {
    const res = await runCli([
      '--json',
      'portal',
      'create',
      '--to',
      'id:t1',
      '--at',
      'parent[x]:id:p1',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(String(env.error?.message ?? '')).toContain('--at');
  });

  it('rejects portal create --at standalone', async () => {
    const res = await runCli([
      '--json',
      'portal',
      'create',
      '--to',
      'id:t1',
      '--at',
      'standalone',
      '--dry-run',
    ]);

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toBe('');

    const env = parseJsonLine(res.stdout);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('INVALID_ARGS');
    expect(String(env.error?.message ?? '')).toContain('standalone');
  });
});
