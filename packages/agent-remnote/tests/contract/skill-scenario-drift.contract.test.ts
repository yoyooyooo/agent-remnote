import { describe, expect, it } from 'vitest';
import {
  notionSkillExportConfigured,
  readNotionRemnoteGuidance,
  readNotionSkillHandoff,
} from '../helpers/notionSkillGuidance.js';

describe('contract: remnote skill scenario drift', () => {
  it('retains the exact Notion owner and verified snapshot receipt', () => {
    const handoff = readNotionSkillHandoff();
    expect(handoff.files.some((file) => file.path === 'evals/evals.json')).toBe(true);
    expect(handoff.files.some((file) => file.path === 'evals/trigger-evals.json')).toBe(true);
  });

  it.skipIf(!notionSkillExportConfigured)(
    'checks scenario authoring and user-store routing in a complete Notion export',
    () => {
      const skill = readNotionRemnoteGuidance();

      for (const subcommand of ['validate', 'normalize', 'explain', 'generate']) {
        expect(skill).toContain(`scenario schema ${subcommand}`);
      }

      expect(skill).toContain('scenario builtin install');
      expect(skill).toContain('~/.agent-remnote/scenarios');
      expect(skill).toContain('scenario run');
      expect(skill).toMatch(/planned|experimental/i);
      expect(skill).not.toContain('031 Scenario 注意事项');
    },
  );
});
