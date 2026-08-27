import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const output = join(root, 'dist', 'desktop');
const rendererOutput = join(output, 'renderer');

rmSync(output, { recursive: true, force: true });
mkdirSync(rendererOutput, { recursive: true });

const esbuild = join(root, 'node_modules', 'esbuild', 'bin', 'esbuild');
const runEsbuild = (args) => execFileSync(process.execPath, [esbuild, ...args], { cwd: root, stdio: 'inherit' });

runEsbuild([
  'src/desktop/main.ts', '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  '--external:electron', '--define:import.meta.url=undefined',
  '--outfile=dist/desktop/main.cjs', '--log-level=warning',
]);
runEsbuild([
  'src/desktop/preload.ts', '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  '--external:electron', '--outfile=dist/desktop/preload.cjs', '--log-level=warning',
]);
runEsbuild([
  'src/desktop/renderer.ts', '--bundle', '--platform=browser', '--format=iife', '--target=chrome128',
  '--outfile=dist/desktop/renderer/app.js', '--log-level=warning',
]);

cpSync('src/desktop/renderer/index.html', join(rendererOutput, 'index.html'));
cpSync('src/desktop/renderer/styles.css', join(rendererOutput, 'styles.css'));
cpSync('src/runtime/bot-worker.mjs', join(output, 'bot-worker.js'));

console.log('桌面游戏资源已生成: dist/desktop');
