import { expect } from 'vitest';

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'base_url' || key === 'timeout_ms') continue;
    out[key] = sanitize(entry);
  }
  return out;
}

export function expectParityEqual(localValue: unknown, remoteValue: unknown): void {
  expect(sanitize(remoteValue)).toEqual(sanitize(localValue));
}
