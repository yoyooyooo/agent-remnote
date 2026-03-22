import {
  createModeParityAdapter,
  type ModeParityAdapter,
  type ModeParityCapabilityHandler,
  type ModeParityCapabilityId,
} from './modeParityRuntime.js';

export function createRemoteModeAdapter(
  handlers: Partial<Record<ModeParityCapabilityId, ModeParityCapabilityHandler>> = {},
): ModeParityAdapter {
  return createModeParityAdapter('remote', handlers);
}
