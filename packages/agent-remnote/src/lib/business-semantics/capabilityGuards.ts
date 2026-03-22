import { modeParityCapabilityIds, type ModeParityCapabilityId } from './modeParityRuntime.js';

export const modeParityRequirementIds = [
  ...modeParityCapabilityIds,
  'resolve.placement',
  'title.inference',
  'receipt.enrichment',
] as const;

export type ModeParityRequirementId = ModeParityCapabilityId | 'resolve.placement' | 'title.inference' | 'receipt.enrichment';

const knownModeParityRequirements = new Set<ModeParityRequirementId>(modeParityRequirementIds);

export function assertKnownModeParityRequirements(capabilities: readonly ModeParityRequirementId[]): void {
  for (const capability of capabilities) {
    if (!knownModeParityRequirements.has(capability)) {
      throw new Error(`Unknown ModeParity capability: ${capability}`);
    }
  }
}
