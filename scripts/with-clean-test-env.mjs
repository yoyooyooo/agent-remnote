import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function usage() {
  console.error('Usage: node scripts/with-clean-test-env.mjs <command> [args...]');
  process.exit(2);
}

const [, , command, ...args] = process.argv;

if (!command) {
  usage();
}

const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-remnote-ci-home-'));
const xdgConfigHome = path.join(tmpHome, '.config');
const xdgDataHome = path.join(tmpHome, '.local', 'share');

await fs.mkdir(xdgConfigHome, { recursive: true });
await fs.mkdir(xdgDataHome, { recursive: true });

const env = { ...process.env };
env.HOME = tmpHome;
env.USERPROFILE = tmpHome;
env.XDG_CONFIG_HOME = xdgConfigHome;
env.XDG_DATA_HOME = xdgDataHome;

for (const key of [
  'REMNOTE_CONFIG_FILE',
  'AGENT_REMNOTE_CONFIG_FILE',
  'REMNOTE_API_BASE_URL',
  'REMNOTE_API_HOST',
  'REMNOTE_API_PORT',
  'REMNOTE_API_BASE_PATH',
  'REMNOTE_API_PID_FILE',
  'REMNOTE_API_LOG_FILE',
  'REMNOTE_API_STATE_FILE',
  'PORT',
]) {
  delete env[key];
}

let exitCode = 1;

try {
  exitCode = await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32',
    });

    child.on('error', (error) => {
      console.error(`with-clean-test-env: failed to spawn child: ${String(error?.message || error)}`);
      resolve(1);
    });

    child.on('close', (code, signal) => {
      if (signal) {
        console.error(`with-clean-test-env: child terminated by signal ${signal}`);
        resolve(1);
        return;
      }
      resolve(typeof code === 'number' ? code : 1);
    });
  });
} finally {
  await fs.rm(tmpHome, { recursive: true, force: true });
}

process.exit(exitCode);
