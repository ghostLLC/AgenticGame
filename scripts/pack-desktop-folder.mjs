import { cpSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const releaseRoot = join(root, 'release');
const target = join(releaseRoot, 'AgenticGame-win-x64');
const appRoot = join(target, 'resources', 'app');

rmSync(target, { recursive: true, force: true });
mkdirSync(releaseRoot, { recursive: true });
cpSync(join(root, 'node_modules', 'electron', 'dist'), target, { recursive: true });
renameSync(join(target, 'electron.exe'), join(target, 'AgenticGame.exe'));
rmSync(join(target, 'resources', 'default_app.asar'), { force: true });
mkdirSync(appRoot, { recursive: true });
cpSync(join(root, 'dist', 'desktop'), join(appRoot, 'dist', 'desktop'), { recursive: true });
cpSync(join(root, 'dist', 'agent-bridge', 'AgenticGame-Agent.exe'), join(target, 'AgenticGame-Agent.exe'));
writeFileSync(join(appRoot, 'package.json'), JSON.stringify({
  name: 'agentic-game',
  version: '0.1.0',
  productName: 'AgenticGame',
  main: 'dist/desktop/main.cjs',
}, null, 2));

console.log(`可运行桌面版已生成: ${join(target, 'AgenticGame.exe')}`);
console.log(`外部 Agent 接口已生成: ${join(target, 'AgenticGame-Agent.exe')}`);
