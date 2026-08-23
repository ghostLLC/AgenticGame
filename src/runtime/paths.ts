// 资源路径解析：同时兼容两种运行形态
//  - dev：tsx 直接跑 src/cli/index.ts（ESM，import.meta.url 定位）
//  - 打包：esbuild bundle 成 CJS 后由 pkg 嵌入 exe（__dirname 定位虚拟 FS）
// 每类资源给两个候选相对路径，依次检查存在性。

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

declare const __dirname: string | undefined;

const thisDir: string =
  typeof __dirname !== 'undefined' ? __dirname : fileURLToPath(new URL('.', import.meta.url));

const CANDIDATES: Record<string, string[]> = {
  // dev: src/runtime/ 下的 mjs；bundle: dist/ 下打包出的 js
  worker: ['../runtime/bot-worker.mjs', 'bot-worker.js'],
  // dev: 项目根的 viewer/；bundle: dist/assets/viewer/
  viewer: ['../../viewer/index.html', 'assets/viewer/index.html'],
  // dev: src/server/；bundle: dist/assets/
  console: ['../../src/server/console.html', 'assets/console.html'],
  // dev: 项目根的 bots/；bundle: dist/assets/bots/
  botsDir: ['../../bots', 'assets/bots'],
  // dev: 项目根的 docs/；bundle: dist/assets/docs/
  spec: ['../../docs/tank-spec.md', 'assets/docs/tank-spec.md'],
};

export type AssetName = keyof typeof CANDIDATES & string;

export function resolveAsset(name: AssetName): string {
  for (const rel of CANDIDATES[name]!) {
    const p = join(thisDir, rel);
    if (existsSync(p)) return p;
  }
  throw new Error(`内置资源未找到: ${name}（可能打包配置有误）`);
}

/** 是否运行在 pkg 单文件 exe 中 */
export function isPackaged(): boolean {
  return !!(process as unknown as { pkg?: unknown }).pkg;
}
