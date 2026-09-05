import { constants } from 'node:fs';
import { access, copyFile, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { acquireWriteLease } from '../storage/write-lease.js';
import { cleanAbandonedTemps } from '../storage/quarantine-journal.js';

export interface ReplayMetadataV1 {
  version: 1;
  replayId: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

const KEYS = ['version', 'replayId', 'note', 'createdAt', 'updatedAt'] as const;
const REPLAY_ID = /^[0-9a-f]{64}$/;
let temporarySequence = 0;

export function assertReplayMetadataV1(input: unknown): ReplayMetadataV1 {
  if (!isRecord(input)) throw invalid('record');
  const keys = Object.keys(input);
  if (keys.length !== KEYS.length || keys.some((key) => !KEYS.includes(key as typeof KEYS[number]))) {
    throw invalid('fields');
  }
  if (input.version !== 1) throw invalid('version');
  if (typeof input.replayId !== 'string' || !REPLAY_ID.test(input.replayId)) throw invalid('replayId');
  if (typeof input.note !== 'string' || input.note !== input.note.trim() || [...input.note].length > 240) {
    throw invalid('note');
  }
  const createdAt = canonicalInstant(input.createdAt);
  const updatedAt = canonicalInstant(input.updatedAt);
  if (!createdAt || !updatedAt || updatedAt < createdAt) throw invalid('time');
  return structuredClone(input) as unknown as ReplayMetadataV1;
}

export class ReplayMetadataRepositoryV1 {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async save(input: ReplayMetadataV1): Promise<ReplayMetadataV1> {
    const metadata = assertReplayMetadataV1(input);
    await mkdir(this.root, { recursive: true });
    const release = await acquireWriteLease(resolve(this.root, `.${metadata.replayId}.lock`));
    try {
    await cleanAbandonedTemps(this.root, new RegExp(`^\\.${metadata.replayId}\\.tmp-[a-zA-Z0-9-]+$`));
    temporarySequence += 1;
    const target = this.fileFor(metadata.replayId);
    try { await this.load(metadata.replayId); } catch {
      await copyFile(target, `${target}.corrupt-${randomUUID()}`, constants.COPYFILE_EXCL);
    }
    const temporary = resolve(this.root, `.${metadata.replayId}.tmp-${process.pid}-${temporarySequence}`);
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return structuredClone(metadata);
    } finally { await release(); }
  }

  async load(replayId: string): Promise<ReplayMetadataV1 | undefined> {
    validateReplayId(replayId);
    let text: string;
    try {
      text = await readFile(this.fileFor(replayId), 'utf8');
    } catch (error) {
      if (isCode(error, 'ENOENT')) return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Invalid ReplayMetadataV1: ${replayId}`);
    }
    const metadata = assertReplayMetadataV1(parsed);
    if (metadata.replayId !== replayId) throw new Error(`Replay metadata path mismatch: ${replayId}`);
    return metadata;
  }

  async list(): Promise<ReplayMetadataV1[]> {
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch (error) {
      if (isCode(error, 'ENOENT')) return [];
      throw error;
    }
    const ids = entries.flatMap((entry) => {
      const match = /^([0-9a-f]{64})\.json$/.exec(entry);
      if (!match) return [];
      return [match[1]!];
    });
    const values = await Promise.all(ids.map((id) => this.load(id)));
    return values.flatMap((value) => value ? [value] : []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  filePath(replayId: string): string {
    return this.fileFor(replayId);
  }

  private fileFor(replayId: string): string {
    validateReplayId(replayId);
    return resolve(this.root, `${replayId}.json`);
  }
}

function validateReplayId(replayId: string): void {
  if (!REPLAY_ID.test(replayId)) throw new Error(`Invalid replayId: ${replayId}`);
}

function canonicalInstant(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString() === value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(issue: string): Error {
  return new Error(`Invalid ReplayMetadataV1: ${issue}`);
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
