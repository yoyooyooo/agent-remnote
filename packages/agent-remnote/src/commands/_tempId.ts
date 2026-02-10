export function makeUuidLike(): string {
  const g: any = globalThis as any;
  if (g.crypto && typeof g.crypto.randomUUID === 'function') return String(g.crypto.randomUUID());
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

export function makeTempId(): string {
  return `tmp:${makeUuidLike()}`;
}
