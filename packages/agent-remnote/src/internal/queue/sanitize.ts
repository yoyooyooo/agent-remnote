export function sanitizeRemnoteWriteText(input: string): string {
  // RemNote treats "→" as a flashcard trigger keyword; replace it before writing to avoid unintended flashcards.
  return input.includes('→') ? input.replaceAll('→', '=>') : input;
}

export function sanitizeRemnoteWritePayload(value: any): any {
  if (typeof value === 'string') return sanitizeRemnoteWriteText(value);
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeRemnoteWritePayload(v));
  if (typeof value !== 'object') return value;

  const out: any = {};
  for (const [k, v] of Object.entries(value)) out[k] = sanitizeRemnoteWritePayload(v);
  return out;
}
