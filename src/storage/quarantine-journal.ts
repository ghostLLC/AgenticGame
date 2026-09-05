import { access, mkdir, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeAtomicJson } from './atomic-json.js';
import { acquireWriteLease } from './write-lease.js';

const JOURNAL = '.quarantine-pending';
const ID = /^[a-zA-Z0-9_-]{1,100}$/;

/** Called only while holding this repository's write lease. Finish the published move intent. */
export async function recoverQuarantine(directory: string, destinationParent: string | undefined): Promise<void> {
  const journalPath = resolve(directory, JOURNAL);
  let value: unknown;
  try { value = JSON.parse(await readFile(journalPath, 'utf8')); }
  catch (error) { if (hasCode(error, 'ENOENT')) return; throw new Error('隔离操作记录无法读取，原文件已保留。', { cause: error }); }
  const journal = value as { version?: unknown; destinationId?: unknown; files?: unknown } | null;
  if (!destinationParent || journal?.version !== 1 || typeof journal.destinationId !== 'string' || !ID.test(journal.destinationId)
    || !Array.isArray(journal.files) || !journal.files.every((file) => typeof file === 'string' && /^[1-9]\d*\.json$/.test(file))
    || new Set(journal.files).size !== journal.files.length) throw new Error('隔离操作记录无效，原文件已保留。');
  const destination = resolve(destinationParent, journal.destinationId);
  await mkdir(destination, { recursive: true });
  for (const file of journal.files as string[]) {
    const sourcePath = resolve(directory, file);
    const targetPath = resolve(destination, file);
    const [sourceExists, targetExists] = await Promise.all([exists(sourcePath), exists(targetPath)]);
    if (sourceExists === targetExists) throw new Error('隔离文件存在冲突或缺失，已停止整理并保留现场。');
    if (sourceExists) await rename(sourcePath, targetPath);
  }
  await unlink(journalPath);
}

/** Readers acquire the writer lease only when an interrupted move needs recovery. */
export async function recoverQuarantineIfPending(directory: string, destinationParent: string | undefined, lockName: string): Promise<void> {
  if (!await exists(resolve(directory, JOURNAL))) return;
  const release = await acquireWriteLease(resolve(directory, lockName));
  try { await recoverQuarantine(directory, destinationParent); } finally { await release(); }
}

export async function quarantineFiles(directory: string, destinationParent: string, destinationId: string, files: string[]): Promise<void> {
  if (!ID.test(destinationId)) throw new Error('Invalid quarantine ID');
  await mkdir(destinationParent, { recursive: true });
  // Refuse an existing batch rather than overwriting files from an earlier recovery.
  await mkdir(resolve(destinationParent, destinationId));
  await writeAtomicJson(resolve(directory, JOURNAL), { version: 1, destinationId, files });
  await recoverQuarantine(directory, destinationParent);
}

/** The lease proves no current writer owns these exact temporary filename patterns. */
export async function cleanAbandonedTemps(directory: string, pattern: RegExp): Promise<void> {
  for (const entry of await readdir(directory)) {
    if (pattern.test(entry)) await unlink(resolve(directory, entry)).catch((error) => { if (!hasCode(error, 'ENOENT')) throw error; });
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch (error) { if (hasCode(error, 'ENOENT')) return false; throw error; }
}
function hasCode(error: unknown, code: string): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === code; }
