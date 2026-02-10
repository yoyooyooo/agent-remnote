import { OP_CATALOG } from '../../kernel/op-catalog/index.js';

// Export a concise, LLM-friendly catalog of supported op types and snake_case payload fields.
// Notes:
// - CLI normalizes payload keys to snake_case before enqueuing.
// - camelCase input keys are accepted, but the canonical form is snake_case.

export const TYPES: Record<string, { required: string[]; optional: string[]; description?: string; aliases?: string[] }> =
  Object.fromEntries(
    Object.entries(OP_CATALOG).map(([type, entry]) => [
      type,
      {
        required: Array.from(entry.payload.required),
        optional: Array.from(entry.payload.optional),
        description: entry.description,
        aliases: entry.aliases ? Array.from(entry.aliases) : undefined,
      },
    ]),
  );
