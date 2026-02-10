import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { runWorkerJob } from '../../src/services/WorkerRunner.js';

async function writeWorkerModule(dir: string, name: string, content: string): Promise<URL> {
  const filePath = path.join(dir, name);
  await writeFile(filePath, content, 'utf8');
  return pathToFileURL(filePath);
}

describe('WorkerRunner (unit)', () => {
  it('returns the worker result envelope payload', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-worker-runner-'));
    try {
      const url = await writeWorkerModule(
        tmp,
        'ok.mjs',
        "import { parentPort, workerData } from 'node:worker_threads'; parentPort?.postMessage({ ok: true, result: workerData });",
      );

      const res = await runWorkerJob({
        url,
        workerData: { hello: 'world' },
        timeoutMs: 5000,
        onTimeout: () => new Error('timeout'),
      });

      expect(res).toEqual({ hello: 'world' });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('terminates the worker on timeout and exposes diagnostics', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'agent-remnote-worker-runner-'));
    try {
      const url = await writeWorkerModule(tmp, 'hang.mjs', 'setTimeout(() => {}, 60_000)');

      let thrown: unknown;
      try {
        await runWorkerJob({
          url,
          workerData: { kind: 'hang' },
          timeoutMs: 200,
          onTimeout: (diag) => {
            const e = new Error(`timeout after ${diag.timeoutMs}ms`);
            (e as any).code = 'TIMEOUT';
            return e;
          },
        });
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(Error);
      const anyErr = thrown as any;
      expect(anyErr.code).toBe('TIMEOUT');
      expect(anyErr.details).toMatchObject({ timeoutMs: 200 });
      expect(typeof anyErr.details.threadId).toBe('number');
      expect(String(anyErr.details.url)).toContain('hang.mjs');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
