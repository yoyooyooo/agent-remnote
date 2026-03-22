import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { remnoteCommandInventory } from '../../src/lib/business-semantics/commandInventory.js';
import {
  wave1RemnoteBusinessCommands,
  wave1RemnoteBusinessCommandVerificationCases,
} from '../helpers/remnoteBusinessCommandMatrix.js';
import { wave1RemnoteBusinessCommandContractIds } from '../helpers/remnoteBusinessCommandContracts.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const AUTHORITATIVE_DOC = path.join(REPO_ROOT, 'docs/ssot/agent-remnote/runtime-mode-and-command-parity.md');

function extractInventoryJson(markdown: string): unknown {
  const start = '<!-- COMMAND_INVENTORY:START -->';
  const end = '<!-- COMMAND_INVENTORY:END -->';
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  const body = markdown.slice(startIndex + start.length, endIndex).trim();
  expect(body.startsWith('```json')).toBe(true);
  expect(body.endsWith('```')).toBe(true);
  const jsonText = body.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  return JSON.parse(jsonText);
}

describe('contract: remnote business command classification', () => {
  it('keeps the authoritative inventory doc and code mirror aligned at command level', () => {
    const markdown = readFileSync(AUTHORITATIVE_DOC, 'utf8');
    const parsed = extractInventoryJson(markdown) as {
      readonly commands: readonly {
        readonly id: string;
        readonly classification: string;
        readonly wave: string;
        readonly parityTarget: string;
      }[];
    };

    const docCommands = parsed.commands.map((command) => ({
      id: command.id,
      classification: command.classification,
      wave: command.wave,
      parityTarget: command.parityTarget,
    }));

    const codeCommands = remnoteCommandInventory.map((command) => ({
      id: command.id,
      classification: command.classification,
      wave: command.wave,
      parityTarget: command.parityTarget,
    }));

    expect(codeCommands).toEqual(docCommands);
    expect(new Set(codeCommands.map((command) => command.id)).size).toBe(codeCommands.length);
    expect(codeCommands.every((command) => command.id.trim().length > 0)).toBe(true);
    expect(codeCommands.every((command) => !/\s/.test(command.id))).toBe(true);
  });

  it('keeps the Wave 1 helper aligned with the inventory mirror', () => {
    const expected = remnoteCommandInventory
      .filter((command) => command.classification === 'business' && command.wave === 'wave1')
      .map((command) => command.id);

    expect(wave1RemnoteBusinessCommands).toEqual(expected);
  });

  it('blocks Wave 1 business commands that lack verification mapping or executable registry coverage', () => {
    const expected = remnoteCommandInventory
      .filter((command) => command.classification === 'business' && command.wave === 'wave1')
      .map((command) => command.id);
    const contractIds = new Set<string>(wave1RemnoteBusinessCommandContractIds);

    for (const commandId of expected) {
      expect(Array.isArray(wave1RemnoteBusinessCommandVerificationCases[commandId])).toBe(true);
      expect(wave1RemnoteBusinessCommandVerificationCases[commandId]?.length ?? 0).toBeGreaterThan(0);
      expect(contractIds.has(commandId)).toBe(true);
    }
  });
});
