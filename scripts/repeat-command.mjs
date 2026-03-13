import { spawn } from 'node:child_process';

function usage() {
  console.error('Usage: node scripts/repeat-command.mjs <times> <command> [args...]');
  process.exit(2);
}

const [, , timesRaw, ...command] = process.argv;
const times = Number(timesRaw);

if (!Number.isInteger(times) || times <= 0 || command.length === 0) {
  usage();
}

function runOnce(iteration, total, cmd, args) {
  return new Promise((resolve) => {
    console.log(`[repeat ${iteration}/${total}] ${cmd} ${args.join(' ')}`.trim());
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });

    child.on('close', (code, signal) => {
      if (signal) {
        console.error(`[repeat ${iteration}/${total}] terminated by signal ${signal}`);
        resolve(1);
        return;
      }
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

const [cmd, ...args] = command;
for (let i = 1; i <= times; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  const exitCode = await runOnce(i, times, cmd, args);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
