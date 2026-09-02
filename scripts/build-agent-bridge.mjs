import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  '--outfile=dist/agent-bridge/bridge.cjs', '--log-level=warning',
]);
runEsbuild([
  'src/runtime/bot-worker.mjs', '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  '--outfile=dist/agent-bridge/bot-worker.js', '--log-level=warning',
]);

writeFileSync(pkgConfig, JSON.stringify({
  name: 'agentic-game-agent-bridge',
  version: '0.1.0',
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
], { cwd: root, stdio: 'inherit' });

console.log(`Agent Bridge 已生成: ${bridgeExe}`);
