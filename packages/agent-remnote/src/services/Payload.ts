import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { promises as fs } from 'node:fs';

import { CliError } from './Errors.js';

export interface PayloadService {
  readonly readJson: (spec: string) => Effect.Effect<unknown, CliError>;
  readonly normalizeKeys: (value: unknown) => unknown;
}

export class Payload extends Context.Tag('Payload')<Payload, PayloadService>() {}

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

function decamelize(s: string): string {
  return s
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z\d]+)/g, '$1_$2')
    .toLowerCase();
}

function normalizeKeys(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => normalizeKeys(v));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[decamelize(k)] = normalizeKeys(v);
  }
  return out;
}

async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new CliError({
      code: 'INVALID_ARGS',
      message: 'When using --payload -, JSON must be piped via stdin',
      exitCode: 2,
    });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readPayloadSpec(spec: string): Promise<string> {
  if (spec === '-') {
    return await readAllStdin();
  }
  if (spec.startsWith('@')) {
    const filePath = spec.slice(1).trim();
    if (!filePath) {
      throw new CliError({ code: 'INVALID_ARGS', message: 'Payload file path cannot be empty', exitCode: 2 });
    }
    return await fs.readFile(filePath, 'utf8');
  }
  return spec;
}

export const PayloadLive = Layer.succeed(Payload, {
  readJson: (spec) =>
    Effect.tryPromise({
      try: async () => {
        const raw = await readPayloadSpec(spec);
        const bytes = Buffer.byteLength(raw, 'utf8');
        if (bytes > MAX_PAYLOAD_BYTES) {
          throw new CliError({
            code: 'PAYLOAD_TOO_LARGE',
            message: `Payload is too large (${bytes} bytes); split it and try again`,
            exitCode: 2,
            details: { bytes, max_bytes: MAX_PAYLOAD_BYTES },
          });
        }
        try {
          return JSON.parse(raw);
        } catch (error) {
          throw new CliError({
            code: 'INVALID_PAYLOAD',
            message: 'Payload is not valid JSON',
            exitCode: 2,
            details: { error: String((error as any)?.message || error) },
          });
        }
      },
      catch: (error) => {
        if (error && typeof error === 'object' && (error as any)._tag === 'CliError') return error as CliError;
        return new CliError({
          code: 'INTERNAL',
          message: 'Failed to read payload',
          exitCode: 1,
          details: { error: String((error as any)?.message || error) },
        });
      },
    }),
  normalizeKeys,
} satisfies PayloadService);
