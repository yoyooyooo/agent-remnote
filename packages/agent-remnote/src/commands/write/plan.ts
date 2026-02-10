import { makeWritePlanCommand } from '../_writePlanCommand.js';

export const writePlanCommand = makeWritePlanCommand({
  commandName: 'plan',
  includeOpCountInSuccessData: true,
  aliasesBeforeNotifyInMd: true,
});
