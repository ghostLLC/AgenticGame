import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { uptime } from 'node:os';
import { dirname, resolve } from 'node:path';

/** The kernel releases the mutex on process death. The file also excludes old writers. */
export async function acquireWriteLease(path: string, busy = '数据正在保存，请稍后重试。'): Promise<() => Promise<void>> {
  const canonical = resolve(path);
  const key = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  const server = createServer((socket) => socket.destroy());
  const address = process.platform === 'win32' ? `\\\\.\\pipe\\agentic-write-${key}`
    : process.platform === 'linux' ? `\0agentic-write-${key}` : undefined;
  await new Promise<void>((done, reject) => {
    server.once('error', () => reject(new Error(busy)));
    if (address) server.listen(address, done);
    else server.listen({ host: '127.0.0.1', port: 20000 + Number.parseInt(key.slice(0, 6), 16) % 40000, exclusive: true }, done);
  });
  server.unref();
  const close = () => new Promise<void>((done) => server.close(() => done()));
  try {
    await mkdir(dirname(canonical), { recursive: true });
    try {
      const previous = await readFile(canonical, 'utf8');
      let ownedByKernelProtocol = false;
      try { ownedByKernelProtocol = JSON.parse(previous).protocol === 'kernel-lease-v1'; } catch { /* legacy lock */ }
      if (!ownedByKernelProtocol) {
        const info = await stat(canonical);
        // An anonymous legacy lock cannot safely be stolen from a live old version.
        if (info.mtimeMs >= Date.now() - uptime() * 1000) {
          throw new Error('检测到旧版写入锁。请关闭旧版程序并重启电脑，随后重新打开；已有版本不会被删除。');
        }
      }
      await unlink(canonical);
    } catch (error) {
      if (!isCode(error, 'ENOENT')) throw error;
    }
    await writeFile(canonical, JSON.stringify({ protocol: 'kernel-lease-v1', pid: process.pid, nonce: randomUUID() }), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await close();
    throw error;
  }
  return async () => {
    try { await unlink(canonical); } finally { await close(); }
  };
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
