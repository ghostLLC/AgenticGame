import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

export type ReplayTrashSourceV1 = 'practice' | 'friend-public';

export interface ReplayTrashEntryV1 {
  version: 1;
  entryId: string;
  replayId: string;
  source: ReplayTrashSourceV1;
  deletedAt: string;
  hasMetadata: boolean;
}

export interface ReplayTrashMoveInputV1 {
  replayId: string;
  source: ReplayTrashSourceV1;
  replayPath: string;
  metadataPath?: string;
}

export interface ReplayTrashRestoreTargetsV1 {
  replayPath: string;
  metadataPath?: string;
}

export interface ReplayTrashRepositoryOptionsV1 {
  now?: () => string;
  retentionMs?: number;
}

const REPLAY_ID = /^[0-9a-f]{64}$/;
const ENTRY_ID = /^(practice|friend-public)-[0-9a-f]{64}$/;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export class ReplayTrashRepositoryV1 {
  readonly root: string;
  private readonly entriesRoot: string;
  private readonly now: () => string;
  private readonly retentionMs: number;

  constructor(root: string, options: ReplayTrashRepositoryOptionsV1 = {}) {
    this.root = resolve(root);
    this.entriesRoot = resolve(this.root, 'entries');
    this.now = options.now ?? (() => new Date().toISOString());
    this.retentionMs = options.retentionMs ?? SEVEN_DAYS;
    if (!Number.isSafeInteger(this.retentionMs) || this.retentionMs < 1) throw new Error('Invalid replay trash retention');
  }

  async move(input: ReplayTrashMoveInputV1): Promise<ReplayTrashEntryV1> {
    validateReplayId(input.replayId);
    validateSource(input.source);
    const replayPath = resolve(input.replayPath);
    const metadataPath = input.metadataPath === undefined ? undefined : resolve(input.metadataPath);
    if (!await exists(replayPath)) throw new Error(`Replay does not exist: ${input.replayId}`);
    const hasMetadata = metadataPath !== undefined && await exists(metadataPath);
    const entryId = `${input.source}-${input.replayId}`;
    const directory = this.directoryFor(entryId);
    await mkdir(this.entriesRoot, { recursive: true });
    await mkdir(directory);
    const moved: Array<{ from: string; to: string }> = [];
    try {
      const trashedReplay = resolve(directory, 'replay.json');
      await rename(replayPath, trashedReplay);
      moved.push({ from: replayPath, to: trashedReplay });
      if (hasMetadata && metadataPath) {
        const trashedMetadata = resolve(directory, 'metadata.json');
        await rename(metadataPath, trashedMetadata);
        moved.push({ from: metadataPath, to: trashedMetadata });
      }
      const entry: ReplayTrashEntryV1 = {
        version: 1,
        entryId,
        replayId: input.replayId,
        source: input.source,
        deletedAt: canonicalInstant(this.now()),
        hasMetadata,
      };
      await writeRecord(resolve(directory, 'entry.json'), entry);
      return structuredClone(entry);
    } catch (error) {
      for (const item of [...moved].reverse()) await rename(item.to, item.from).catch(() => undefined);
      await removeValidatedDirectory(this.entriesRoot, directory).catch(() => undefined);
      throw error;
    }
  }

  async restore(entryId: string, targets: ReplayTrashRestoreTargetsV1): Promise<ReplayTrashEntryV1> {
    const entry = await this.load(entryId);
    const directory = this.directoryFor(entryId);
    const replayTarget = resolve(targets.replayPath);
    const metadataTarget = targets.metadataPath === undefined ? undefined : resolve(targets.metadataPath);
    if (await exists(replayTarget)) throw new Error('Replay restore target already exists');
    if (entry.hasMetadata && (!metadataTarget || await exists(metadataTarget))) {
      throw new Error('Replay metadata restore target already exists or is missing');
    }
    await mkdir(resolve(replayTarget, '..'), { recursive: true });
    if (metadataTarget) await mkdir(resolve(metadataTarget, '..'), { recursive: true });
    const moved: Array<{ from: string; to: string }> = [];
    try {
      const replaySource = resolve(directory, 'replay.json');
      await rename(replaySource, replayTarget);
      moved.push({ from: replaySource, to: replayTarget });
      if (entry.hasMetadata && metadataTarget) {
        const metadataSource = resolve(directory, 'metadata.json');
        await rename(metadataSource, metadataTarget);
        moved.push({ from: metadataSource, to: metadataTarget });
      }
      await removeValidatedDirectory(this.entriesRoot, directory);
      return structuredClone(entry);
    } catch (error) {
      for (const item of [...moved].reverse()) await rename(item.to, item.from).catch(() => undefined);
      throw error;
    }
  }

  async list(): Promise<ReplayTrashEntryV1[]> {
    let directories: string[];
    try {
      directories = await readdir(this.entriesRoot);
    } catch (error) {
      if (isCode(error, 'ENOENT')) return [];
      throw error;
    }
    const entries = await Promise.all(directories.filter((entry) => ENTRY_ID.test(entry)).map((entry) => this.load(entry)));
    return entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.entryId.localeCompare(b.entryId));
  }

  async purgeExpired(now: string): Promise<string[]> {
    const instant = Date.parse(canonicalInstant(now));
    const expired = (await this.list()).filter((entry) => instant - Date.parse(entry.deletedAt) >= this.retentionMs);
    for (const entry of expired) await removeValidatedDirectory(this.entriesRoot, this.directoryFor(entry.entryId));
    return expired.map((entry) => entry.entryId);
  }

  async empty(confirmed: boolean): Promise<string[]> {
    if (confirmed !== true) throw new Error('Replay trash empty confirmation is required');
    const entries = await this.list();
    for (const entry of entries) await removeValidatedDirectory(this.entriesRoot, this.directoryFor(entry.entryId));
    return entries.map((entry) => entry.entryId);
  }

  private async load(entryId: string): Promise<ReplayTrashEntryV1> {
    validateEntryId(entryId);
    const text = await readFile(resolve(this.directoryFor(entryId), 'entry.json'), 'utf8');
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Invalid replay trash entry: ${entryId}`);
    }
    if (!isRecord(value)
      || value.version !== 1
      || value.entryId !== entryId
      || typeof value.replayId !== 'string' || !REPLAY_ID.test(value.replayId)
      || (value.source !== 'practice' && value.source !== 'friend-public')
      || value.deletedAt !== canonicalInstant(value.deletedAt)
      || typeof value.hasMetadata !== 'boolean') {
      throw new Error(`Invalid replay trash entry: ${entryId}`);
    }
    return structuredClone(value) as unknown as ReplayTrashEntryV1;
  }

  private directoryFor(entryId: string): string {
    validateEntryId(entryId);
    return resolve(this.entriesRoot, entryId);
  }
}

async function writeRecord(path: string, entry: ReplayTrashEntryV1): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function removeValidatedDirectory(root: string, target: string): Promise<void> {
  const relation = relative(root, target);
  if (!relation || relation.startsWith('..') || resolve(root, relation) !== target) throw new Error('Unsafe replay trash target');
  await rm(target, { recursive: true, force: true });
}

function validateReplayId(value: string): void {
  if (!REPLAY_ID.test(value)) throw new Error('Invalid replayId');
}

function validateEntryId(value: string): void {
  if (!ENTRY_ID.test(value)) throw new Error('Invalid replay trash entryId');
}

function validateSource(value: string): asserts value is ReplayTrashSourceV1 {
  if (value !== 'practice' && value !== 'friend-public') throw new Error('Invalid replay source');
}

function canonicalInstant(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('Invalid replay trash time');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (isCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === code;
}
