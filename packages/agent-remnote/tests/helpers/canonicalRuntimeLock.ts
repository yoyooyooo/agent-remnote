import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const LOCK_PATH = path.join(os.tmpdir(), 'agent-remnote-canonical-runtime.lock');

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function pidIsRunning(pid: number | undefined): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireCanonicalRuntimeLock(timeoutMs = 120_000): Promise<() => Promise<void>> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(LOCK_PATH, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquired_at: Date.now() })}\n`, 'utf8');
      } finally {
        await handle.close();
      }

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await fs.rm(LOCK_PATH, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;

      try {
        const raw = await fs.readFile(LOCK_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!pidIsRunning(parsed?.pid)) {
          await fs.rm(LOCK_PATH, { force: true });
          continue;
        }
      } catch {
        await fs.rm(LOCK_PATH, { force: true });
        continue;
      }

      await sleep(200);
    }
  }

  throw new Error(`Timed out waiting for canonical runtime lock: ${LOCK_PATH}`);
}
