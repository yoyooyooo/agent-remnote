import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { resolveStableLauncherSpec } from '../../src/lib/runtime-ownership/launcher.js';

describe('stable launcher resolution', () => {
  const previousVoltaHome = process.env.VOLTA_HOME;
  const previousCmd = process.env.AGENT_REMNOTE_STABLE_LAUNCHER_CMD;
  const previousArgs = process.env.AGENT_REMNOTE_STABLE_LAUNCHER_ARGS_JSON;

  afterEach(() => {
    if (previousVoltaHome === undefined) delete process.env.VOLTA_HOME;
    else process.env.VOLTA_HOME = previousVoltaHome;
    if (previousCmd === undefined) delete process.env.AGENT_REMNOTE_STABLE_LAUNCHER_CMD;
    else process.env.AGENT_REMNOTE_STABLE_LAUNCHER_CMD = previousCmd;
    if (previousArgs === undefined) delete process.env.AGENT_REMNOTE_STABLE_LAUNCHER_ARGS_JSON;
    else process.env.AGENT_REMNOTE_STABLE_LAUNCHER_ARGS_JSON = previousArgs;
  });

  it('falls back to the Volta shim when no explicit launcher is configured', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-launcher-'));
    const binDir = path.join(tmpDir, 'bin');
    const shim = path.join(binDir, process.platform === 'win32' ? 'agent-remnote.cmd' : 'agent-remnote');

    delete process.env.AGENT_REMNOTE_STABLE_LAUNCHER_CMD;
    delete process.env.AGENT_REMNOTE_STABLE_LAUNCHER_ARGS_JSON;
    process.env.VOLTA_HOME = tmpDir;

    try {
      await fs.mkdir(binDir, { recursive: true });
      await fs.writeFile(shim, '', 'utf8');
      const spec = resolveStableLauncherSpec();
      expect(spec).toMatchObject({
        command: shim,
        args: ['stack', 'ensure'],
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
