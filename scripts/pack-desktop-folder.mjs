import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseRoot = join(root, 'release');
const builderOutput = join(releaseRoot, 'win-unpacked');
const target = join(releaseRoot, 'AgenticGame-win-x64');
const builderCache = join(root, '.cache', 'electron-builder');
const builderCli = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

mkdirSync(releaseRoot, { recursive: true });
mkdirSync(builderCache, { recursive: true });
const result = spawnSync(process.execPath, [builderCli, '--win', 'dir', '--x64', '--publish', 'never'], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_BUILDER_CACHE: builderCache,
  },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`桌面目录打包失败，退出码 ${result.status ?? 1}`);
}

rmSync(target, { recursive: true, force: true });
renameSync(builderOutput, target);

console.log(`可运行桌面版已生成: ${join(target, 'AgenticGame.exe')}`);
console.log(`外部 Agent 接口已生成: ${join(target, 'AgenticGame-Agent.exe')}`);
