import * as Options from '@effect/cli/Options';

import { optionToUndefined } from './_shared.js';

export const subjectOption = Options.text('subject');

export const optionalSubjectOption = Options.text('subject').pipe(Options.optional, Options.map(optionToUndefined));

export const repeatedSubjectOption = Options.text('subject').pipe(Options.repeated);
