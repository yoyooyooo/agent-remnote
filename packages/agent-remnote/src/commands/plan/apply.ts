import { makeWritePlanCommand } from '../_writePlanCommand.js';

export const planApplyCommand = makeWritePlanCommand({
  commandName: 'apply',
  includeOpCountInSuccessData: false,
  aliasesBeforeNotifyInMd: false,
});
