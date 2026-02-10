import { z, type ZodRawShape } from 'zod';
import path from 'node:path';

import { discoverBackups, expandHome, parseOrThrow, REMNOTE_RELATIVE_DIR } from './shared.js';
import { homeDir } from '../../lib/paths.js';

const inputShape = {
  basePath: z.string().optional().describe('RemNote base directory (default: ~/remnote)'),
  limit: z.number().int().min(1).max(200).optional().describe('Max backups to return (default 50)'),
} satisfies ZodRawShape;

export const listRemBackupsSchema = z.object(inputShape);
export type ListRemBackupsInput = z.infer<typeof listRemBackupsSchema>;

export async function executeListRemBackups(params: ListRemBackupsInput) {
  const parsed = parseOrThrow(listRemBackupsSchema, params, { label: 'list_rem_backups' });
  const basePath = expandHome(parsed.basePath ?? path.join(homeDir(), REMNOTE_RELATIVE_DIR));
  const backups = await discoverBackups(basePath);
  const limit = parsed.limit ?? 50;

  return {
    basePath,
    total: backups.length,
    items: backups.slice(0, limit),
  };
}
