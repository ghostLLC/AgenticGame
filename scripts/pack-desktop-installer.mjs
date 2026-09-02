import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const builderCache = join(projectRoot, '.cache', 'electron-builder');
const builderCli = join(projectRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

mkdirSync(builderCache, { recursive: true });

const result = spawnSync(process.execPath, [builderCli, '--win', 'nsis', '--x64'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ELECTRON_BUILDER_CACHE: builderCache,
  },
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
