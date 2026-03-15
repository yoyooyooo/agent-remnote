import { describe, expect, it } from 'vitest';

async function loadRuntime() {
  globalThis.self = globalThis;
  return await import('../src/bridge/runtime.ts');
}

describe('runtime reset', () => {
  it('clears sticky sync state across reload boundaries', async () => {
    const runtime = await loadRuntime();

    runtime.__setRuntimeStateForTests({
      syncing: true,
      activeSyncRunId: 42,
      syncWatchdogTrippedUntil: Date.now() + 60_000,
    });

    runtime.resetRuntimeState();

    expect(runtime.__getRuntimeStateForTests()).toEqual({
      syncing: false,
      activeSyncRunId: 0,
      syncWatchdogTrippedUntil: 0,
    });
  });
});
