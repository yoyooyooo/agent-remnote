import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';

import * as Effect from 'effect/Effect';

import { StatusLineFile, StatusLineFileLive } from '../../src/services/StatusLineFile.js';

function write(params: {
  readonly text: string;
  readonly textFilePath?: string | undefined;
  readonly debug?: boolean | undefined;
  readonly jsonFilePath?: string | undefined;
  readonly json?: unknown;
}) {
  return Effect.gen(function* () {
    const svc = yield* StatusLineFile;
    return yield* svc.write(params);
  }).pipe(Effect.provide(StatusLineFileLive));
}

describe('StatusLineFile (unit)', () => {
  it('writes a single-line file and is idempotent', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-status-line-'));
    try {
      const filePath = path.join(tmpDir, 'status-line.txt');

      const first = await Effect.runPromise(write({ text: 'RN', textFilePath: filePath }));
      expect(first.wrote).toBe(true);
      expect(await readFile(filePath, 'utf8')).toBe('RN\n');

      const second = await Effect.runPromise(write({ text: 'RN', textFilePath: filePath }));
      expect(second.wrote).toBe(false);
      expect(await readFile(filePath, 'utf8')).toBe('RN\n');

      const dir = await readdir(tmpDir);
      expect(dir.filter((n) => n.includes('status-line.txt.tmp-'))).toEqual([]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('expands ~ in file paths', async () => {
    const tmpDir = await mkdtemp(path.join(os.homedir(), 'agent-remnote-status-line-home-'));
    try {
      const filePath = path.join(tmpDir, 'status-line.txt');
      const rel = path.relative(os.homedir(), filePath);
      const spec = `~/${rel}`;

      await Effect.runPromise(write({ text: 'WSx ↓1', textFilePath: spec }));
      expect(await readFile(filePath, 'utf8')).toBe('WSx ↓1\n');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('writes JSON sidecar when debug is enabled', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-status-line-'));
    try {
      const textFilePath = path.join(tmpDir, 'status-line.txt');
      const jsonFilePath = path.join(tmpDir, 'status-line.json');

      await Effect.runPromise(
        write({ text: 'TXT', textFilePath, debug: true, jsonFilePath, json: { source: 'cli_fallback', ok: true } }),
      );

      expect(await readFile(textFilePath, 'utf8')).toBe('TXT\n');
      const raw = await readFile(jsonFilePath, 'utf8');
      const parsed = JSON.parse(raw.trim());
      expect(parsed).toMatchObject({ source: 'cli_fallback', ok: true });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
