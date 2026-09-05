import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBotWorker } from './build-bot-worker.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const requested = process.argv.indexOf('--output');
const output = requested < 0 ? join(root, 'dist', 'desktop') : resolve(root, process.argv[requested + 1] ?? '');
const temporaryRelative = relative(join(root, '.tmp'), output);
if (output !== join(root, 'dist', 'desktop') && (!temporaryRelative || temporaryRelative.startsWith('..') || isAbsolute(temporaryRelative))) {
  throw new Error('Alternate build output must be a child of the project .tmp directory');
}
const rendererOutput = join(output, 'renderer');

rmSync(output, { recursive: true, force: true });
mkdirSync(rendererOutput, { recursive: true });

const esbuild = join(root, 'node_modules', 'esbuild', 'bin', 'esbuild');
const runEsbuild = (args) => execFileSync(process.execPath, [esbuild, ...args], { cwd: root, stdio: 'inherit' });

runEsbuild([
  'src/desktop/main.ts', '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  '--external:electron', '--external:jsonc-parser', '--define:import.meta.url=undefined',
  '--banner:js=try {',
  '--footer:js=} catch (error) { const electron = require("electron"); electron.dialog.showErrorBox("AgenticGame 启动失败", "游戏文件未能加载。请重新安装完整版本；本机战术与回放会保留。"); electron.app.quit(); }',
  `--outfile=${join(output, 'main.cjs')}`, '--log-level=warning',
]);
runEsbuild([
  'src/desktop/preload.ts', '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  '--external:electron', `--outfile=${join(output, 'preload.cjs')}`, '--log-level=warning',
]);
runEsbuild([
  'src/desktop/renderer.ts', '--bundle', '--platform=browser', '--format=iife', '--target=chrome128',
  `--outfile=${join(rendererOutput, 'app.js')}`, '--log-level=warning',
]);

cpSync('src/desktop/renderer/index.html', join(rendererOutput, 'index.html'));
cpSync('src/desktop/renderer/styles.css', join(rendererOutput, 'styles.css'));
cpSync('build/icon-1024.png', join(rendererOutput, 'app-icon.png'));
// src/runtime/bot-worker.mjs is compiled with its pinned WASM runtime.
await buildBotWorker(join(output, 'bot-worker.js'));

console.log(`桌面游戏资源已生成: ${relative(root, output)}`);
