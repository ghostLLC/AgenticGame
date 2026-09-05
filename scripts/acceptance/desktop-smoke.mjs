import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Starts the actual packaged main/preload/renderer and a WASM worker from ASAR.
// This is runtime evidence; visual layout and clean installation are separate gates.
const executable = resolve(process.argv[2] ?? 'release/AgenticGame-win-x64/AgenticGame.exe');
const dataRoot = await mkdtemp(join(tmpdir(), 'agentic-desktop-acceptance-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, ['--agentic-acceptance-smoke', `--agentic-data-dir=${dataRoot}`], {
  env, stdio: 'ignore', windowsHide: true,
});
let timer;
try {
  await new Promise((done, reject) => {
    timer = setTimeout(() => { child.kill(); reject(new Error('Packaged desktop did not complete bootstrap within 60 seconds')); }, 60_000);
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? done() : reject(new Error(`Desktop exited with ${code}`)));
  });
  const result = JSON.parse(await readFile(join(dataRoot, 'acceptance-smoke.json'), 'utf8'));
  if (!result.packaged || !result.trustedRendererBootstrap || result.tutorialFrames < 2) throw new Error('Invalid packaged smoke result');
  console.log(JSON.stringify(result));
} finally {
  clearTimeout(timer);
  child.kill();
  await rm(dataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
