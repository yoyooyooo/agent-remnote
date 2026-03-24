import { describe, expect, it } from 'vitest';

async function loadRuntime() {
  globalThis.self = globalThis;
  return await import('../src/bridge/runtime.ts');
}

describe('runtime config helpers', () => {
  it('uses 8 as the default sync concurrency and caps explicit values at 16', async () => {
    const runtime = await loadRuntime();

    expect(runtime.resolveSyncConcurrencySetting(undefined)).toBe(8);
    expect(runtime.resolveSyncConcurrencySetting(null)).toBe(8);
    expect(runtime.resolveSyncConcurrencySetting(4)).toBe(4);
    expect(runtime.resolveSyncConcurrencySetting(32)).toBe(16);
  });

  it('does not introduce a fixed post-op delay', async () => {
    const runtime = await loadRuntime();

    expect(runtime.computePostOpYieldDelayMs(1)).toBe(0);
    expect(runtime.computePostOpYieldDelayMs(10)).toBe(0);
    expect(runtime.computePostOpYieldDelayMs(100)).toBe(0);
  });
});
