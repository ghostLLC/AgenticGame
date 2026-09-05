import { access, lstat, mkdir, readFile, readdir, rename, rm, unlink } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { writeAtomicJson } from '../storage/atomic-json.js';
import { acquireWriteLease } from '../storage/write-lease.js';

export type ReplayTrashSourceV1 = 'practice' | 'friend-public';
export interface ReplayTrashEntryV1 {
  version: 1; entryId: string; replayId: string; source: ReplayTrashSourceV1;
  deletedAt: string; hasMetadata: boolean;
}
export interface ReplayTrashMoveInputV1 {
  replayId: string; source: ReplayTrashSourceV1; replayPath: string; metadataPath?: string;
}
export interface ReplayTrashRestoreTargetsV1 { replayPath: string; metadataPath?: string }
export interface ReplayTrashRepositoryOptionsV1 { now?: () => string; retentionMs?: number }
interface Transaction {
  version: 1; direction: 'move' | 'restore'; entry: ReplayTrashEntryV1;
  replayPath: string; metadataPath?: string;
}
const REPLAY_ID = /^[0-9a-f]{64}$/;
const ENTRY_ID = /^(practice|friend-public)-[0-9a-f]{64}$/;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/** Intents live outside entry folders; interruption cannot orphan a half-moved replay. */
export class ReplayTrashRepositoryV1 {
  readonly root: string;
  private readonly entriesRoot: string;
  private readonly transactionsRoot: string;
  private readonly now: () => string;
  private readonly retentionMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly issues = new Set<string>();

  constructor(root: string, options: ReplayTrashRepositoryOptionsV1 = {}) {
    this.root = resolve(root);
    this.entriesRoot = resolve(this.root, 'entries');
    this.transactionsRoot = resolve(this.root, 'transactions');
    this.now = options.now ?? (() => new Date().toISOString());
    this.retentionMs = options.retentionMs ?? SEVEN_DAYS;
    if (!Number.isSafeInteger(this.retentionMs) || this.retentionMs < 1) throw new Error('Invalid replay trash retention');
  }
  get damagedCount(): number { return this.issues.size; }

  async move(input: ReplayTrashMoveInputV1): Promise<ReplayTrashEntryV1> {
    return this.locked(async () => {
      if (!REPLAY_ID.test(input.replayId) || !['practice', 'friend-public'].includes(input.source)) throw new Error('Invalid replay source or ID');
      const replayPath = await this.safeDataPath(input.replayPath, input.replayId);
      const metadataPath = input.metadataPath === undefined ? undefined : await this.safeDataPath(input.metadataPath, input.replayId);
      if (metadataPath === replayPath) throw new Error('Replay and metadata paths must differ');
      if (!await exists(resolve(dirname(this.root), replayPath))) throw new Error('Replay does not exist');
      const entry: ReplayTrashEntryV1 = { version: 1, entryId: input.source + '-' + input.replayId, replayId: input.replayId,
        source: input.source, deletedAt: canonicalInstant(this.now()),
        hasMetadata: metadataPath !== undefined && await exists(resolve(dirname(this.root), metadataPath)) };
      if (await exists(this.directoryFor(entry.entryId)) || await exists(this.transactionPath(entry.entryId))) throw new Error('Replay trash entry already exists');
      const transaction: Transaction = { version: 1, direction: 'move', entry, replayPath,
        ...(entry.hasMetadata ? { metadataPath } : {}) };
      await writeAtomicJson(this.transactionPath(entry.entryId), transaction);
      // Preserve the intent and every byte on failure. The next access resumes it.
      await this.complete(transaction);
      return structuredClone(entry);
    });
  }
  async restore(entryId: string, targets: ReplayTrashRestoreTargetsV1): Promise<ReplayTrashEntryV1> {
    return this.locked(async () => {
      const entry = await this.load(entryId);
      const replayPath = await this.safeDataPath(targets.replayPath, entry.replayId);
      const metadataPath = targets.metadataPath === undefined ? undefined : await this.safeDataPath(targets.metadataPath, entry.replayId);
      if (metadataPath === replayPath) throw new Error('Replay and metadata paths must differ');
      if (await exists(resolve(dirname(this.root), replayPath))) throw new Error('Replay restore target already exists');
      if (entry.hasMetadata && (!metadataPath || await exists(resolve(dirname(this.root), metadataPath)))) throw new Error('Replay metadata restore target already exists or is missing');
      if (await exists(this.transactionPath(entryId))) throw new Error('Replay recovery requires attention');
      const transaction: Transaction = { version: 1, direction: 'restore', entry, replayPath,
        ...(entry.hasMetadata ? { metadataPath } : {}) };
      await writeAtomicJson(this.transactionPath(entryId), transaction);
      await this.complete(transaction);
      return structuredClone(entry);
    });
  }
  async list(): Promise<ReplayTrashEntryV1[]> { return this.locked(() => this.listHealthy()); }
  async inspect(): Promise<{ entries: ReplayTrashEntryV1[]; damagedCount: number }> {
    return this.locked(async () => ({ entries: await this.listHealthy(), damagedCount: this.issues.size }));
  }
  async loadMetadata(entryId: string): Promise<unknown | null> {
    return this.locked(async () => {
      const entry = await this.load(entryId);
      return entry.hasMetadata ? JSON.parse(await readFile(resolve(this.directoryFor(entryId), 'metadata.json'), 'utf8')) as unknown : null;
    });
  }
  async purgeExpired(now: string): Promise<string[]> {
    const instant = Date.parse(canonicalInstant(now));
    return this.locked(async () => {
      const expired = (await this.listHealthy()).filter((entry) => instant - Date.parse(entry.deletedAt) >= this.retentionMs);
      for (const entry of expired) await this.purge(entry.entryId);
      return expired.map((entry) => entry.entryId);
    });
  }
  async empty(confirmed: boolean): Promise<string[]> {
    if (confirmed !== true) throw new Error('Replay trash empty confirmation is required');
    return this.locked(async () => {
      const entries = await this.listHealthy();
      for (const entry of entries) await this.purge(entry.entryId);
      return entries.map((entry) => entry.entryId);
    });
  }

  private async locked<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(async () => {
      const release = await acquireWriteLease(resolve(this.root, '.write.lock'));
      try { await this.recover(); return await action(); } finally { await release(); }
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  private async recover(): Promise<void> {
    this.issues.clear();
    await mkdir(this.entriesRoot, { recursive: true });
    await mkdir(this.transactionsRoot, { recursive: true });
    for (const file of await readdir(this.transactionsRoot)) {
      const entryId = file.endsWith('.json') ? file.slice(0, -5) : '';
      if (!ENTRY_ID.test(entryId)) continue;
      try {
        const raw: unknown = JSON.parse(await readFile(this.transactionPath(entryId), 'utf8'));
        if (!isRecord(raw) || raw.version !== 1 || !['move', 'restore'].includes(String(raw.direction))) throw new Error('Invalid transaction');
        const entry = validateEntry(raw.entry, entryId);
        if (typeof raw.replayPath !== 'string' || (entry.hasMetadata && typeof raw.metadataPath !== 'string')) throw new Error('Invalid transaction paths');
        await this.complete(raw as unknown as Transaction);
      } catch { this.issues.add(entryId); }
    }
    const purgeRoot = resolve(this.root, 'purging');
    await mkdir(purgeRoot, { recursive: true });
    for (const id of await readdir(purgeRoot)) if (ENTRY_ID.test(id)) await removeValidatedDirectory(purgeRoot, resolve(purgeRoot, id));
  }
  private async complete(transaction: Transaction): Promise<void> {
    const { entry, direction } = transaction;
    const directory = this.directoryFor(entry.entryId);
    const replay = await this.safeDataPath(transaction.replayPath, entry.replayId);
    const metadata = entry.hasMetadata ? await this.safeDataPath(transaction.metadataPath!, entry.replayId) : undefined;
    if (replay === metadata) throw new Error('Invalid transaction paths');
    await mkdir(directory, { recursive: true });
    if ((await lstat(directory)).isSymbolicLink()) throw new Error('Unsafe trash directory');
    const pairs = [{ local: replay, trash: 'replay.json' }, ...(metadata ? [{ local: metadata, trash: 'metadata.json' }] : [])];
    for (const pair of pairs) {
      const local = resolve(dirname(this.root), pair.local);
      const trashed = resolve(directory, pair.trash);
      const [from, to] = direction === 'move' ? [local, trashed] : [trashed, local];
      const [sourceExists, targetExists] = await Promise.all([exists(from), exists(to)]);
      if (sourceExists === targetExists) throw new Error('Replay recovery conflict; files preserved');
      if (sourceExists) { await mkdir(dirname(to), { recursive: true }); await rename(from, to); }
    }
    if (direction === 'move') await writeAtomicJson(resolve(directory, 'entry.json'), entry);
    else await removeValidatedDirectory(this.entriesRoot, directory);
    await unlink(this.transactionPath(entry.entryId));
  }
  private async listHealthy(): Promise<ReplayTrashEntryV1[]> {
    const entries: ReplayTrashEntryV1[] = [];
    for (const id of await readdir(this.entriesRoot)) {
      if (!ENTRY_ID.test(id) || this.issues.has(id)) continue;
      try {
        const directory = this.directoryFor(id);
        if ((await lstat(directory)).isSymbolicLink()) throw new Error('Unsafe trash directory');
        const entry = await this.load(id);
        if (!await exists(resolve(directory, 'replay.json'))) throw new Error('Missing replay');
        entries.push(entry);
      } catch { this.issues.add(id); }
    }
    return entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.entryId.localeCompare(b.entryId));
  }
  private async purge(entryId: string): Promise<void> {
    const purgeRoot = resolve(this.root, 'purging');
    const target = resolve(purgeRoot, entryId);
    await rename(this.directoryFor(entryId), target);
    await removeValidatedDirectory(purgeRoot, target);
  }
  private async load(entryId: string): Promise<ReplayTrashEntryV1> {
    return validateEntry(JSON.parse(await readFile(resolve(this.directoryFor(entryId), 'entry.json'), 'utf8')), entryId);
  }
  private directoryFor(entryId: string): string { validateEntryId(entryId); return resolve(this.entriesRoot, entryId); }
  private transactionPath(entryId: string): string { validateEntryId(entryId); return resolve(this.transactionsRoot, entryId + '.json'); }
  private async safeDataPath(path: string, replayId: string): Promise<string> {
    // Only sibling repository/hash files can be restored, never arbitrary journal paths.
    const target = resolve(dirname(this.root), path);
    const relation = relative(dirname(this.root), target).replaceAll('\\', '/');
    if (!/^[a-zA-Z0-9_-]+\/[0-9a-f]{64}\.json$/.test(relation)
      || dirname(target) === this.root || basename(target) !== replayId + '.json') throw new Error('Unsafe replay data path');
    try { if ((await lstat(dirname(target))).isSymbolicLink()) throw new Error('Unsafe replay data directory'); }
    catch (error) { if (!isCode(error, 'ENOENT')) throw error; }
    return relation;
  }
}
function validateEntry(value: unknown, entryId: string): ReplayTrashEntryV1 {
  validateEntryId(entryId);
  if (!isRecord(value) || value.version !== 1 || value.entryId !== entryId
    || typeof value.replayId !== 'string' || !REPLAY_ID.test(value.replayId)
    || (value.source !== 'practice' && value.source !== 'friend-public')
    || value.source + '-' + value.replayId !== entryId
    || value.deletedAt !== canonicalInstant(value.deletedAt) || typeof value.hasMetadata !== 'boolean') throw new Error('Invalid replay trash entry');
  return structuredClone(value) as unknown as ReplayTrashEntryV1;
}
async function removeValidatedDirectory(root: string, target: string): Promise<void> {
  const relation = relative(root, target);
  if (!ENTRY_ID.test(relation) || resolve(root, relation) !== target) throw new Error('Unsafe replay trash target');
  await rm(target, { recursive: true, force: true });
}
function validateEntryId(value: string): void { if (!ENTRY_ID.test(value)) throw new Error('Invalid replay trash entryId'); }
function canonicalInstant(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid replay trash time');
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch (error) { if (isCode(error, 'ENOENT')) return false; throw error; }
}
function isCode(error: unknown, code: string): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === code; }
