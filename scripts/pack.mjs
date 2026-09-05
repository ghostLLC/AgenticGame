// 打包脚本：esbuild 打两个 CJS bundle → 组装 dist/assets → @yao-pkg/pkg 生成 arena.exe
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBotWorker } from './build-bot-worker.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist', 'legacy-cli');
const esbuild = join(root, 'node_modules', 'esbuild', 'bin', 'esbuild');
const pkg = join(root, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });

// 1) 主入口 bundle（CJS；esbuild 会把 import.meta 相关代码按 cjs 语义处理，
//    paths.ts 里的 __dirname 探测会自动生效）
execFileSync(process.execPath, [esbuild, 'src/cli/index.ts', '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  '--define:import.meta.url=undefined', `--outfile=${join(dist, 'cli.bundle.js')}`, '--log-level=warning'], {stdio:'inherit',cwd:root});

// 2) worker 单独 bundle（不与主包共享，保持单文件独立加载）
await buildBotWorker(join(dist, 'bot-worker.js'));

// 3) 运行时读取的资产（paths.ts 的 bundle 候选路径：assets/...）
cpSync('viewer', join(dist, 'assets', 'viewer'), { recursive: true });
cpSync('bots', join(dist, 'assets', 'bots'), { recursive: true });
cpSync('docs', join(dist, 'assets', 'docs'), { recursive: true });
cpSync('src/server/console.html', join(dist, 'assets', 'console.html'));

// 4) pkg 配置（assets 随 exe 嵌入虚拟 FS）
writeFileSync(
  join(dist, 'package.json'),
  JSON.stringify({
    name: 'tank-arena-app',
    version: '0.1.0',
    pkg: {
      assets: ['assets/**/*', 'bot-worker.js'],
      outputPath: '.',
    },
  }),
);

// 5) 生成 exe（Windows x64；首次会下载 node runtime 基座）
execFileSync(process.execPath, [pkg, join(dist, 'cli.bundle.js'), '--config', join(dist, 'package.json'),
  '-t', 'node22-win-x64', '-o', join(root, 'arena.exe'), '--no-bytecode', '--public', '--public-packages', '*',
  '--options', 'max-old-space-size=128,stack-size=1024'], {stdio:'inherit',cwd:root});

console.log('\n完成: arena.exe（双击启动浏览器控制台；replays/ 与 my-bots/ 生成在 exe 同目录）');
