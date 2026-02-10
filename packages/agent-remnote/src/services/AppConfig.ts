import * as Context from 'effect/Context';

import type { ResolvedConfig } from './Config.js';

export class AppConfig extends Context.Tag('AppConfig')<AppConfig, ResolvedConfig>() {}
