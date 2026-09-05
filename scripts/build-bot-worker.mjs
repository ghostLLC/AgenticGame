import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const variant = '@jitl/quickjs-wasmfile-release-sync';

/** Embed the exact pinned interpreter bytes; packaged children need no downloads. */
export async function buildBotWorker(outfile) {
  return build({
    entryPoints: [fileURLToPath(new URL('../src/runtime/bot-worker.mjs', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    logLevel: 'warning',
    define: {
      __AGENTIC_WASM_BASE64__: JSON.stringify(readFileSync(require.resolve(`${variant}/wasm`)).toString('base64')),
    },
    plugins: [{
      name: 'standalone-quickjs-loader',
      setup(builder) {
        builder.onResolve({filter: /^@jitl\/quickjs-wasmfile-release-sync\/emscripten-module$/},
          () => ({path: require.resolve(`${variant}/emscripten-module`)}));
      },
    }],
  });
}
