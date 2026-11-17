import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const OWNER = '41b5636c-236e-81a7-9619-f91a83e4164a';
const IMPORTED_PATHS = [
  'SKILL.md',
  'SKILL.toml',
  'evals/evals.json',
  'evals/trigger-evals.json',
  'references/failure-recovery.md',
  'references/payload-handoff.md',
  'references/promotion-and-apply.md',
  'references/remnote-concepts.md',
  'references/remote-parity.md',
  'references/runtime-ops.md',
  'references/scenario-surface.md',
  'references/table-property-boundaries.md',
  'references/write-basic.md',
  'references/write-routes.md',
];
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const handoffSchema = z.object({
  version: z.literal(1),
  kind: z.literal('notion_skill_handoff'),
  name: z.literal('remnote'),
  page_id: z.literal(OWNER),
  skill_id: z.literal('skill-31315f6a2cee5e080a920c8bf7af564dc96ae47cd92d44b5a4c0efcdd4431c67'),
  ref: z.literal(`skill://${OWNER}/SKILL.md`),
  snapshot_id: z.string().regex(/^s_[a-f0-9]{64}$/),
  normal_consumer: z.object({
    status: z.literal('verified'),
    completed_at: z.string().datetime(),
    proof_sha256: hash,
  }),
  export_metadata: z.object({
    path: z.literal('.ntn-skills.json'),
    sha256: hash,
    bytes: z.number().int().nonnegative(),
    mode: z.literal('100644'),
  }),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        file_id: z.string().min(1),
        page_id: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
        sha256: hash,
        bytes: z.number().int().nonnegative(),
        mode: z.enum(['100644', '100755']),
      }),
    )
    .length(IMPORTED_PATHS.length),
});

export const notionSkillExportConfigured = Boolean(process.env.AGENT_REMNOTE_SKILL_EXPORT_DIR);

/** This receipt records a completed observation; it is not a local copy of the Skill. */
export function readNotionSkillHandoff() {
  const receipt: unknown = JSON.parse(readFileSync(path.join(REPO_ROOT, 'docs/skill-handoffs/remnote.json'), 'utf8'));
  const handoff = handoffSchema.parse(receipt);
  const paths = handoff.files.map((file) => file.path);
  if (
    JSON.stringify([...paths].sort()) !== JSON.stringify(IMPORTED_PATHS) ||
    handoff.files.find((file) => file.path === 'SKILL.md')?.page_id !== OWNER ||
    new Set(paths).size !== paths.length ||
    new Set(handoff.files.map((file) => file.file_id)).size !== paths.length ||
    new Set(handoff.files.map((file) => file.page_id)).size !== paths.length ||
    paths.some(
      (file) =>
        file.includes('\\') ||
        file.includes('\0') ||
        file.startsWith('/') ||
        file.split('/').some((part) => part === '' || part === '.' || part === '..'),
    )
  )
    throw new Error('The Notion Skill handoff must identify one complete canonical file tree.');
  return handoff;
}

/** External content checks require a complete export of the recorded fixed snapshot.
 * The ordinary repository test suite never fetches Notion or substitutes a local Skill. */
export function readNotionRemnoteGuidance(): string {
  const root = process.env.AGENT_REMNOTE_SKILL_EXPORT_DIR;
  if (!root || !path.isAbsolute(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
    throw new Error('AGENT_REMNOTE_SKILL_EXPORT_DIR must name an absolute fixed-snapshot export directory.');
  const handoff = readNotionSkillHandoff();
  const observed: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`A fixed Skill export cannot contain a symlink: ${name}`);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) observed.push(name);
      else throw new Error(`Unsupported Skill export entry: ${name}`);
    }
  };
  walk('');
  const exportedFiles = [...handoff.files, handoff.export_metadata];
  const expected = exportedFiles.map((file) => file.path).sort();
  if (JSON.stringify(observed.sort()) !== JSON.stringify(expected))
    throw new Error('The supplied export does not contain the complete recorded Notion file tree.');
  const markdown: string[] = [];
  for (const file of exportedFiles) {
    const absolute = path.join(root, ...file.path.split('/'));
    const bytes = readFileSync(absolute);
    const mode = lstatSync(absolute).mode & 0o111 ? '100755' : '100644';
    if (
      bytes.length !== file.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== file.sha256 ||
      mode !== file.mode
    )
      throw new Error(`The supplied export differs from the recorded Notion file: ${file.path}`);
    if (/\.(?:md|markdown)$/i.test(file.path)) markdown.push(bytes.toString('utf8'));
  }
  return markdown.join('\n\n');
}
