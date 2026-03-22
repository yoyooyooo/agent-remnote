import { describe, expect, it } from 'vitest';

import { remnoteCommandInventory } from '../../src/lib/business-semantics/commandInventory.js';
import { modeParityRequirementIds, wave1CommandContracts } from '../../src/lib/business-semantics/commandContracts.js';
import { wave1RemnoteBusinessCommandContractIds } from '../helpers/remnoteBusinessCommandContracts.js';

describe('contract: remnote business command contracts', () => {
  it('keeps the Wave 1 executable registry aligned with the authoritative inventory mirror', () => {
    const expected = remnoteCommandInventory
      .filter((command) => command.classification === 'business' && command.wave === 'wave1')
      .map((command) => command.id);

    const actual = wave1CommandContracts.map((command) => command.command_id);

    expect(actual).toEqual(expected);
    expect(wave1RemnoteBusinessCommandContractIds).toEqual(expected);
    expect(new Set(actual).size).toBe(actual.length);
  });

  it('requires every Wave 1 contract row to declare runtime capabilities and verification cases', () => {
    const knownCapabilities = new Set(modeParityRequirementIds);

    for (const contract of wave1CommandContracts) {
      expect(contract.required_capabilities.length).toBeGreaterThan(0);
      expect(contract.verification_case_ids.length).toBeGreaterThan(0);
      expect(typeof contract.local_use_case).toBe('string');
      expect(contract.local_use_case.length).toBeGreaterThan(0);
      expect(typeof contract.remote_endpoint).toBe('string');
      expect(contract.remote_endpoint.length).toBeGreaterThan(0);

      for (const capability of contract.required_capabilities) {
        expect(knownCapabilities.has(capability)).toBe(true);
      }
    }
  });
});
