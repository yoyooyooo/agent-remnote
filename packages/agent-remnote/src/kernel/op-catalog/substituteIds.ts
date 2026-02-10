import { idFieldPathsForOpType } from './idFields.js';
import { collectLeafValues, mapLeafValuesInPlace, parsePathTokens } from './pathWalk.js';

function isTempId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith('tmp:');
}

function cloneJson(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => cloneJson(v));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = cloneJson(v);
  }
  return out;
}

export function collectTempIdsFromPayload(opTypeRaw: unknown, payload: unknown): readonly string[] {
  if (!payload || typeof payload !== 'object') return [];

  const out: string[] = [];
  for (const path of idFieldPathsForOpType(opTypeRaw)) {
    const tokens = parsePathTokens(path);
    if (tokens.length === 0) continue;

    const values = collectLeafValues(payload as any, tokens);
    for (const value of values) {
      if (isTempId(value) && !out.includes(value.trim())) out.push(value.trim());
    }
  }

  return out;
}

export function substituteTempIdsInPayload(
  opTypeRaw: unknown,
  payload: unknown,
  idMap: Readonly<Record<string, string>>,
): unknown {
  if (!payload || typeof payload !== 'object') return payload;

  const out = cloneJson(payload) as any;

  for (const path of idFieldPathsForOpType(opTypeRaw)) {
    const tokens = parsePathTokens(path);
    if (tokens.length === 0) continue;

    mapLeafValuesInPlace(out, tokens, (value) => {
      if (!isTempId(value)) return value;
      const mapped = idMap[value.trim()];
      return mapped ? mapped : value;
    });
  }

  return out;
}
