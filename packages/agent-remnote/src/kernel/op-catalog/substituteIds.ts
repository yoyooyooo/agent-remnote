import { idFieldPathsForOpType } from './idFields.js';

function isTempId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().startsWith('tmp:');
}

function parsePath(path: string): { readonly segments: readonly string[]; readonly array: boolean } {
  const array = path.endsWith('[]');
  const raw = array ? path.slice(0, -2) : path;
  const segments = raw.split('.').filter(Boolean);
  return { segments, array };
}

function getAt(root: any, segments: readonly string[]): any {
  let cur = root;
  for (const k of segments) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function setAt(root: any, segments: readonly string[], value: any): void {
  let cur = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const k = segments[i]!;
    const next = cur[k];
    if (!next || typeof next !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[segments[segments.length - 1]!] = value;
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
  for (const p of idFieldPathsForOpType(opTypeRaw)) {
    const parsed = parsePath(p);
    const current = getAt(payload as any, parsed.segments);
    if (parsed.array) {
      if (!Array.isArray(current)) continue;
      for (const v of current) {
        if (isTempId(v) && !out.includes(v.trim())) out.push(v.trim());
      }
    } else {
      if (isTempId(current) && !out.includes(current.trim())) out.push(current.trim());
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

  for (const p of idFieldPathsForOpType(opTypeRaw)) {
    const parsed = parsePath(p);
    const current = getAt(out, parsed.segments);
    if (parsed.array) {
      if (!Array.isArray(current)) continue;
      const next = current.map((v: unknown) => {
        if (!isTempId(v)) return v;
        const mapped = idMap[v.trim()];
        return mapped ? mapped : v;
      });
      setAt(out, parsed.segments, next);
    } else {
      if (!isTempId(current)) continue;
      const mapped = idMap[current.trim()];
      if (mapped) setAt(out, parsed.segments, mapped);
    }
  }

  return out;
}

