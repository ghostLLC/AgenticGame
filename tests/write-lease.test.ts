import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, utimes } from 'node:fs/promises';
import { tmpdir, uptime } from 'node:os';
import { join, resolve } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { build } from 'esbuild';
import { acquireWriteLease } from '../src/storage/write-lease.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'agentic-lease-')); roots.push(root); return root; }

it('excludes concurrent owners and releases the mutex after a killed process', async () => {
  const root = await fixture();
  const entry = join(root, 'child.cjs');
  await build({ stdin: { contents: `import { acquireWriteLease } from ${JSON.stringify(resolve('src/storage/write-lease.ts'))}; acquireWriteLease(process.argv[2]).then(() => { process.send('ready'); setInterval(() => {}, 1000); });`, resolveDir: process.cwd() }, outfile: entry, platform: 'node', format: 'cjs', bundle: true });
  const path = join(root, '.save.lock');
  const child = fork(entry, [path], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    await once(child, 'message');
    await expect(acquireWriteLease(path)).rejects.toThrow('正在保存');
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    expect(JSON.parse(await readFile(path, 'utf8')).protocol).toBe('kernel-lease-v1');
    const release = await acquireWriteLease(path); await release();
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { child.kill(); }
});

it('preserves ambiguous legacy locks, recovering only those older than the OS boot', async () => {
  const root = await fixture(); const path = join(root, '.save.lock');
  await writeFile(path, '');
  await expect(acquireWriteLease(path)).rejects.toThrow('重启电脑');
  const beforeBoot = new Date(Date.now() - (uptime() + 60) * 1000);
  await utimes(path, beforeBoot, beforeBoot);
  const release = await acquireWriteLease(path); await release();
});
