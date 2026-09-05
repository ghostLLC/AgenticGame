import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBotWorker } from './build-bot-worker.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist', 'agent-bridge');
const esbuild = join(root, 'node_modules', 'esbuild', 'bin', 'esbuild');
const pkgCli = join(root, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');
const bridgeBundle = join(output, 'bridge.cjs');
const bridgeExe = join(output, 'AgenticGame-Agent.exe');
const pkgConfig = join(output, 'package.json');

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const runEsbuild = (args) => execFileSync(process.execPath, [esbuild, ...args], { cwd: root, stdio: 'inherit' });
runEsbuild([
  'src/agent/bridge-cli-v1.ts', '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  '--define:import.meta.url=undefined',
  '--outfile=dist/agent-bridge/bridge.cjs', '--log-level=warning',
]);
await buildBotWorker(join(output, 'bot-worker.js'));

writeFileSync(pkgConfig, JSON.stringify({
  name: 'agentic-game-agent-bridge',
  version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  pkg: { assets: ['bot-worker.js'], outputPath: '.' },
}, null, 2));

execFileSync(process.execPath, [
  pkgCli,
  bridgeBundle,
  '--config', pkgConfig,
  '-t', 'node22-win-x64',
  '-o', bridgeExe,
  '--no-bytecode',
  '--public',
  '--public-packages', '*',
  '--options', 'max-old-space-size=128,stack-size=1024',
], { cwd: root, stdio: 'inherit' });

console.log(`Agent Bridge 已生成: ${bridgeExe}`);
