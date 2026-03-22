import { wave1CommandContracts } from '../../src/lib/business-semantics/commandContracts.js';

export const wave1RemnoteBusinessCommands = wave1CommandContracts.map((command) => command.command_id);

export const wave1RemnoteBusinessCommandVerificationCases = Object.fromEntries(
  wave1CommandContracts.map((command) => [command.command_id, command.verification_case_ids]),
) as Readonly<Record<(typeof wave1RemnoteBusinessCommands)[number], readonly string[]>>;
