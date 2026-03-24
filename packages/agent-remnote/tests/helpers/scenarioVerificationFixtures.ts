import path from 'node:path';
import { promises as fs } from 'node:fs';

import { getBuiltinScenarioPackage } from '../../src/lib/builtin-scenarios/index.js';

export const dnRecentTodosToTodayMovePackage = getBuiltinScenarioPackage('dn_recent_todos_to_today_move');
export const dnRecentTodosToTodayPortalPackage = getBuiltinScenarioPackage('dn_recent_todos_to_today_portal');

export const dnRecentTodosGenerateHint = {
  goal: 'Collect recent DN todos into today',
  selector_kind: 'query',
  action_kind: 'delivery',
  source_scope: 'daily:last-7d',
  target_ref: 'daily:today',
  vars: [
    { name: 'source_scope', type: 'scope', required: false, default: 'daily:last-7d' },
    { name: 'target_ref', type: 'ref', required: false, default: 'daily:today' },
    { name: 'delivery_mode', type: 'string', required: false, default: 'portal' },
  ],
  constraints: {
    builtin_candidate_id: 'dn_recent_todos_to_today',
    allow_delivery_modes: ['move', 'portal'],
    require_remote_parity: true,
  },
  capabilities: {
    requires: ['powerup_metadata', 'write_runtime'],
  },
} as const;

export const dnRecentTodosPackages = [
  dnRecentTodosToTodayMovePackage,
  dnRecentTodosToTodayPortalPackage,
] as const;

export async function writeJsonFixture(tempDir: string, filename: string, value: unknown): Promise<string> {
  const filePath = path.join(tempDir, filename);
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}
