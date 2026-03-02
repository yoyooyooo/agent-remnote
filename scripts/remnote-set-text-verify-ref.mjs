#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function printUsage() {
  console.log(`Usage:
  node scripts/remnote-set-text-verify-ref.mjs --rem <RID> --text "<content>" [--expect-ref <RID> ...] [--timeout-ms 60000] [--poll-ms 1000]

Behavior:
  1) Run: agent-remnote --json rem set-text ... --wait
  2) Run: agent-remnote --json rem inspect --expand-references
  3) Verify expected refs are present in summary.references

Notes:
  - If --expect-ref is omitted, refs are auto-extracted from --text:
    - ((<RID>))
    - {ref:<RID>}
  - Exit code 0 when verification passes, non-zero otherwise.`);
}

function parseArgs(argv) {
  const out = {
    rem: '',
    text: '',
    expectRefs: [],
    timeoutMs: 60_000,
    pollMs: 1_000,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }
    if (a === '--rem') {
      out.rem = String(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (a === '--text') {
      out.text = String(argv[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (a === '--expect-ref') {
      out.expectRefs.push(String(argv[i + 1] ?? ''));
      i += 1;
      continue;
    }
    if (a === '--timeout-ms') {
      out.timeoutMs = Number(argv[i + 1] ?? out.timeoutMs);
      i += 1;
      continue;
    }
    if (a === '--poll-ms') {
      out.pollMs = Number(argv[i + 1] ?? out.pollMs);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${a}`);
  }

  if (out.help) return out;
  if (!out.rem.trim()) throw new Error('Missing required --rem');
  if (!out.text.trim()) throw new Error('Missing required --text');
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) throw new Error('--timeout-ms must be a positive number');
  if (!Number.isFinite(out.pollMs) || out.pollMs <= 0) throw new Error('--poll-ms must be a positive number');
  return out;
}

function extractRefsFromText(text) {
  const refs = new Set();
  const reParen = /\(\(([A-Za-z0-9]{17})(?:\|[^()]+)?\)\)/g;
  const reBrace = /\{ref:([A-Za-z0-9]{17})\}/g;
  let m;
  while ((m = reParen.exec(text)) !== null) refs.add(m[1]);
  while ((m = reBrace.exec(text)) !== null) refs.add(m[1]);
  return [...refs];
}

function runAgentRemnote(args) {
  const r = spawnSync('agent-remnote', ['--json', ...args], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  if (r.error) throw new Error(`Failed to launch agent-remnote: ${r.error.message}`);
  if (r.status !== 0) {
    const details = (r.stderr || r.stdout || '').trim();
    throw new Error(`agent-remnote exited with code ${r.status}: ${details}`);
  }
  const raw = String(r.stdout || '').trim();
  if (!raw) throw new Error('agent-remnote returned empty stdout');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON output from agent-remnote: ${String(e)}`);
  }
  if (!parsed?.ok) throw new Error(`agent-remnote returned ok=false: ${raw}`);
  return parsed;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String((e && e.message) || e));
    printUsage();
    process.exit(2);
  }

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const remId = args.rem.trim();
  const text = args.text;
  const expectedRefs = args.expectRefs.length > 0 ? [...new Set(args.expectRefs.map((x) => x.trim()).filter(Boolean))] : extractRefsFromText(text);

  const writeResult = runAgentRemnote([
    'rem',
    'set-text',
    '--rem',
    remId,
    '--text',
    text,
    '--wait',
    '--timeout-ms',
    String(args.timeoutMs),
    '--poll-ms',
    String(args.pollMs),
  ]);

  const status = writeResult?.data?.status;
  if (status && status !== 'succeeded') {
    console.error(
      JSON.stringify(
        {
          ok: false,
          stage: 'set-text',
          message: `write status is not succeeded: ${status}`,
          data: writeResult?.data ?? null,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const inspectResult = runAgentRemnote(['rem', 'inspect', '--id', remId, '--expand-references']);
  const actualRefs = Array.isArray(inspectResult?.data?.summary?.references) ? inspectResult.data.summary.references : [];

  const missing = expectedRefs.filter((rid) => !actualRefs.includes(rid));
  const out = {
    ok: missing.length === 0,
    rem_id: remId,
    expected_refs: expectedRefs,
    actual_refs: actualRefs,
    missing_refs: missing,
    txn_id: writeResult?.data?.txn_id ?? null,
  };

  if (missing.length > 0) {
    console.error(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(out, null, 2));
}

main();

