import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..');

fs.rmSync(path.join(packageRoot, 'dist'), { recursive: true, force: true });
fs.rmSync(path.join(packageRoot, 'PluginZip.zip'), { force: true });
