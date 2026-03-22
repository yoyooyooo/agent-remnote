import {
  createModeParityAdapter,
  type ModeParityAdapter,
  type ModeParityCapabilityHandler,
  type ModeParityCapabilityId,
} from './modeParityRuntime.js';

export function createLocalModeAdapter(
  handlers: Partial<Record<ModeParityCapabilityId, ModeParityCapabilityHandler>> = {},
): ModeParityAdapter {
  return createModeParityAdapter('local', handlers);
}
