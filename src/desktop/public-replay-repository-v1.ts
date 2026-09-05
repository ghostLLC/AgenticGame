import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mapLimited } from '../storage/map-limited.js';
import { writeAtomicJson } from '../storage/atomic-json.js';
import { acquireWriteLease } from '../storage/write-lease.js';
import { cleanAbandonedTemps } from '../storage/quarantine-journal.js';
import { hashJson, type JsonValue } from '../core/v2/json.js';
import { assertFriendRoomReplayV1, type FriendRoomReplayV1 } from '../friend-room/replay-v1.js';
import type { PublicReplayInspectionV1, PublicReplayLibraryRepositoryV1 } from './replay-library-service-v1.js';

const SHA256 = /^[0-9a-f]{64}$/;

interface PublicReplayRecordV1 {
  version: 1;
  replayId: string;
  createdAt: string;
  localTeamId: string;
  completionKey: string;
  replay: FriendRoomReplayV1;
}

export interface PublicReplaySaveInputV1 {
  replay: FriendRoomReplayV1;
  createdAt: string;
  localTeamId: string;
  completionKey: string;
}

export class PublicReplayRepositoryV1 implements PublicReplayLibraryRepositoryV1 {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async save(input: PublicReplaySaveInputV1): Promise<{ created: boolean; replayId: string }> {
    const base = normalizeInput(input);
    const replayId = hashJson(base as unknown as JsonValue);
    const record: PublicReplayRecordV1 = { version: 1, replayId, ...base };
    const path = this.filePath(replayId);
    await mkdir(this.root, { recursive: true });
    const release = await acquireWriteLease(resolve(this.root, '.save.lock'));
    try {
    await cleanAbandonedTemps(this.root, /^(?:\.[0-9a-f]{64}\.tmp-\d+|[0-9a-f]{64}\.json\.tmp-[a-zA-Z0-9-]+)$/);
    if (await exists(path)) {
      await this.load(replayId);
      return { created: false, replayId };
    }
    await writeAtomicJson(path, record);
    return { created: true, replayId };
    } finally { await release(); }
  }

  async load(replayId: string): Promise<FriendRoomReplayV1> {
    return (await this.loadRecord(replayId)).replay;
  }

  async inspect(): Promise<PublicReplayInspectionV1[]> {
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch (error) {
      if (isCode(error, 'ENOENT')) return [];
      throw error;
    }
    const ids = entries.flatMap((entry) => /^([0-9a-f]{64})\.json$/.exec(entry)?.[1] ?? []);
    const inspected = await mapLimited(ids, 4, async (replayId): Promise<PublicReplayInspectionV1> => {
      try {
        const record = await this.loadRecord(replayId);
        return {
          replayId,
          state: 'healthy',
          createdAt: record.createdAt,
          localTeamId: record.localTeamId,
          modeName: record.replay.modeName,
          participantNames: record.replay.participants.map((participant) => participant.displayName),
          winningTeamIds: [...record.replay.result.winningTeamIds],
          ticks: record.replay.result.ticks,
        };
      } catch {
        return { replayId, state: 'corrupt', message: '好友房回放未通过完整性校验' };
      }
    });
    return inspected.sort((a, b) => {
      if (a.state !== b.state) return a.state === 'corrupt' ? -1 : 1;
      if (a.state === 'healthy' && b.state === 'healthy') return b.createdAt.localeCompare(a.createdAt) || a.replayId.localeCompare(b.replayId);
      return a.replayId.localeCompare(b.replayId);
    });
  }

  filePath(replayId: string): string {
    validateId(replayId);
    return resolve(this.root, `${replayId}.json`);
  }

  private async loadRecord(replayId: string): Promise<PublicReplayRecordV1> {
    validateId(replayId);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(this.filePath(replayId), 'utf8')) as unknown;
    } catch (error) {
      if (isCode(error, 'ENOENT')) throw new Error(`Public replay not found: ${replayId}`);
      throw new Error(`Invalid public replay: ${replayId}`, { cause: error });
    }
    const record = assertRecord(value, replayId);
    return structuredClone(record);
  }
}

function normalizeInput(input: PublicReplaySaveInputV1): Omit<PublicReplayRecordV1, 'version' | 'replayId'> {
  if (!input || typeof input !== 'object') throw new Error('Invalid public replay input');
  const replay = assertFriendRoomReplayV1(input.replay);
  const createdAt = canonicalInstant(input.createdAt);
  const localTeamId = stableId(input.localTeamId);
  if (!replay.participants.some((participant) => participant.teamId === localTeamId)) throw new Error('Invalid local replay team');
  if (!SHA256.test(input.completionKey)) throw new Error('Invalid public replay completion key');
  return { replay, createdAt, localTeamId, completionKey: input.completionKey };
}

function assertRecord(value: unknown, replayId: string): PublicReplayRecordV1 {
  if (!isRecord(value)
    || !exactKeys(value, ['version', 'replayId', 'createdAt', 'localTeamId', 'completionKey', 'replay'])
    || value.version !== 1
    || value.replayId !== replayId
    || typeof value.createdAt !== 'string'
    || typeof value.localTeamId !== 'string'
    || typeof value.completionKey !== 'string') throw new Error('Invalid public replay record');
  const normalized = normalizeInput({
    replay: value.replay as FriendRoomReplayV1,
    createdAt: value.createdAt,
    localTeamId: value.localTeamId,
    completionKey: value.completionKey,
  });
  if (hashJson(normalized as unknown as JsonValue) !== replayId) throw new Error('Invalid public replay digest');
  return { version: 1, replayId, ...normalized };
}

function validateId(value: string): void {
  if (!SHA256.test(value)) throw new Error('Invalid public replay ID');
}

function stableId(value: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value) || value.length > 64) throw new Error('Invalid public replay team');
  return value;
}

function canonicalInstant(value: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid public replay time');
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
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
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
