import { Command } from '@effect/cli';
import * as Options from '@effect/cli/Options';
import * as Effect from 'effect/Effect';

import { TYPES } from '../../adapters/core.js';

import { CliError } from '../../services/Errors.js';
import { writeFailure, writeSuccess } from '../_shared.js';

function typeHint(field: string): string {
  const f = field.toLowerCase();
  if (f.includes('markdown')) return 'string(markdown)';
  if (f.endsWith('id') || f.endsWith('ids') || f.includes('parentid')) return 'string(remId)';
  if (f.includes('tags') || f.endsWith('ids')) return 'string[]';
  if (f.startsWith('is') || f.startsWith('include') || f.startsWith('exclude') || f.includes('create'))
    return 'boolean';
  if (f.includes('count') || f.includes('size') || f.includes('position') || f.includes('max') || f.includes('ms'))
    return 'number';
  return 'unknown';
}

function exampleValue(field: string): unknown {
  const f = field.toLowerCase();
  if (f.includes('markdown')) return '# Markdown...';
  if (f.endsWith('ids') || f === 'tags') return [];
  if (f.endsWith('id') || f.includes('parentid')) return '<remId>';
  if (f.startsWith('is') || f.startsWith('include') || f.startsWith('exclude') || f.includes('create')) return true;
  if (f.includes('count') || f.includes('size') || f.includes('position') || f.includes('max') || f.includes('ms'))
    return 0;
  if (f.includes('url')) return 'https://example.com';
  return '<value>';
}

export const opsSchemaCommand = Command.make('schema', { type: Options.text('type') }, ({ type }) =>
  Effect.gen(function* () {
    const spec = (TYPES as any)[type] as { required: string[]; optional: string[]; description?: string } | undefined;
    if (!spec) {
      return yield* Effect.fail(
        new CliError({
          code: 'INVALID_ARGS',
          message: `Unknown op type: ${type}`,
          exitCode: 2,
          hint: ['agent-remnote ops list'],
        }),
      );
    }

    const required = Array.isArray(spec.required) ? spec.required : [];
    const optional = Array.isArray(spec.optional) ? spec.optional : [];

    const examplePayload: Record<string, unknown> = {};
    for (const f of required) examplePayload[f] = exampleValue(f);

    const fields = [
      ...required.map((name) => ({ name, required: true, type: typeHint(name) })),
      ...optional.map((name) => ({ name, required: false, type: typeHint(name) })),
    ];

    const data = {
      type,
      description: spec.description ?? '',
      fields,
      example: { type, payload: examplePayload },
    };

    const md = [
      `# ${type}`,
      spec.description ? `- description: ${spec.description}` : '',
      required.length > 0 ? `\n## required` : '',
      ...required.map((f) => `- ${f} (${typeHint(f)})`),
      optional.length > 0 ? `\n## optional` : '',
      ...optional.map((f) => `- ${f} (${typeHint(f)})`),
      `\n## example`,
      '```json',
      JSON.stringify(data.example, null, 2),
      '```',
    ]
      .filter(Boolean)
      .join('\n');

    yield* writeSuccess({ data, md });
  }).pipe(Effect.catchAll(writeFailure)),
);
