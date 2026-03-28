import fs from 'node:fs';
import path from 'node:path';

import { CliError } from '../../services/Errors.js';
import { homeDir } from '../paths.js';

export type StableLauncherSpec = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string | undefined;
};

function defaultVoltaShimPath(): string {
  const voltaHome = process.env.VOLTA_HOME?.trim() || path.join(homeDir(), '.volta');
  return path.join(voltaHome, 'bin', process.platform === 'win32' ? 'agent-remnote.cmd' : 'agent-remnote');
}

export function resolveStableLauncherSpec(): StableLauncherSpec | undefined {
  const command = process.env.AGENT_REMNOTE_STABLE_LAUNCHER_CMD?.trim();
  const argsRaw = process.env.AGENT_REMNOTE_STABLE_LAUNCHER_ARGS_JSON?.trim();
  let baseArgs: string[] = [];
  if (argsRaw) {
    try {
      const parsed = JSON.parse(argsRaw);
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        throw new Error('launcher args json must be an array of strings');
      }
      baseArgs = [...parsed];
    } catch (error) {
      throw new CliError({
        code: 'INVALID_ARGS',
        message: 'Invalid AGENT_REMNOTE_STABLE_LAUNCHER_ARGS_JSON',
        exitCode: 2,
        details: { error: String((error as any)?.message || error) },
      });
    }
  }

  const cwd = process.env.AGENT_REMNOTE_STABLE_LAUNCHER_CWD?.trim();
  if (command) {
    return { command, args: [...baseArgs, 'stack', 'ensure'], cwd: cwd || undefined };
  }

  const shim = defaultVoltaShimPath();
  if (fs.existsSync(shim)) {
    return { command: shim, args: ['stack', 'ensure'] };
  }

  return undefined;
}
