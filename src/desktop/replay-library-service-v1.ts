import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createFriendRoomReplayV1, type FriendRoomReplayV1 } from '../friend-room/replay-v1.js';
import { ReplayRepositoryV2 } from '../replay/repository-v2.js';
import { createReplayStudioViewV2 } from '../replay/studio-v2.js';
import {
  assertReplayMetadataV1,
  ReplayMetadataRepositoryV1,
} from './replay-metadata-repository-v1.js';
import {
  ReplayTrashRepositoryV1,
  type ReplayTrashEntryV1,
  type ReplayTrashSourceV1,
} from './replay-trash-repository-v1.js';

const SHA256 = /^[0-9a-f]{64}$/;

export type ReplaySourceV1 = 'practice' | 'friend-public';
export type ReplayOutcomeV1 = 'victory' | 'defeat' | 'draw';

export interface ReplayLibraryFilterV1 {
  source?: ReplaySourceV1;
  modeId?: 'duel' | 'capture';
  outcome?: ReplayOutcomeV1;
  buildRevision?: number;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ReplayCardV1 {
  replayId: string;
  source: ReplaySourceV1;
  createdAt: string;
  modeName: string;
  participantNames: string[];
  outcome: ReplayOutcomeV1;
  ticks: number;
  note: string;
  integrity: 'verified' | 'damaged';
  playable: boolean;
}

export type PublicReplayInspectionV1 =
  | {
    replayId: string;
    state: 'healthy';
    createdAt: string;
    localTeamId: string;
    modeName: string;
    participantNames: string[];
    winningTeamIds: string[];
    ticks: number;
  }
  | { replayId: string; state: 'corrupt'; message: string };

export interface PublicReplayLibraryRepositoryV1 {
  inspect(): Promise<PublicReplayInspectionV1[]>;
  load(replayId: string): Promise<FriendRoomReplayV1>;
  filePath(replayId: string): string;
}

export interface ReplayLibraryOptionsV1 {
  replayRepository: ReplayRepositoryV2;
  publicRepository: PublicReplayLibraryRepositoryV1;
  metadataRepository: ReplayMetadataRepositoryV1;
  trashRepository: ReplayTrashRepositoryV1;
  exportsRoot: string;
  now?: () => string;
}

export interface ReplayLibrarySnapshotV1 {
  cards: ReplayCardV1[];
  counts: { all: number; practice: number; friendPublic: number; damaged: number; trash: number };
}

export interface ReplayTrashCardV1 extends ReplayTrashEntryV1 {
  note: string;
}

interface Candidate {
  card: ReplayCardV1;
  modeId?: string;
  revisions: number[];
}

export class ReplayLibraryServiceV1 {
  private readonly replayRepository: ReplayRepositoryV2;
  private readonly publicRepository: PublicReplayLibraryRepositoryV1;
  private readonly metadataRepository: ReplayMetadataRepositoryV1;
  private readonly trashRepository: ReplayTrashRepositoryV1;
  private readonly exportsRoot: string;
  private readonly now: () => string;

  constructor(options: ReplayLibraryOptionsV1) {
    this.replayRepository = options.replayRepository;
    this.publicRepository = options.publicRepository;
    this.metadataRepository = options.metadataRepository;
    this.trashRepository = options.trashRepository;
    this.exportsRoot = resolve(options.exportsRoot);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async list(filter: ReplayLibraryFilterV1): Promise<ReplayLibrarySnapshotV1> {
    const normalized = normalizeFilter(filter);
    await this.trashRepository.purgeExpired(this.now());
    const candidates = [
      ...await this.localCandidates(),
      ...await this.publicCandidates(),
    ].sort((a, b) => b.card.createdAt.localeCompare(a.card.createdAt) || a.card.replayId.localeCompare(b.card.replayId));
    const trash = await this.trashRepository.list();
    return {
      cards: candidates.filter((candidate) => matches(candidate, normalized)).map((candidate) => candidate.card),
      counts: {
        all: candidates.length,
        practice: candidates.filter((candidate) => candidate.card.source === 'practice').length,
        friendPublic: candidates.filter((candidate) => candidate.card.source === 'friend-public').length,
        damaged: candidates.filter((candidate) => candidate.card.integrity === 'damaged').length,
        trash: trash.length,
      },
    };
  }

  async open(replayId: string, source: ReplaySourceV1): Promise<{ replayId: string; source: ReplaySourceV1; replay: FriendRoomReplayV1 }> {
    validateReplayId(replayId);
    validateSource(source);
    const replay = source === 'practice'
      ? createFriendRoomReplayV1(await this.replayRepository.load(replayId))
      : await this.publicRepository.load(replayId);
    return { replayId, source, replay: structuredClone(replay) };
  }

  async updateNote(replayId: string, source: ReplaySourceV1, note: string): Promise<void> {
    validateReplayId(replayId);
    validateSource(source);
    await this.ensureExists(replayId, source);
    const existing = await this.metadataRepository.load(replayId);
    const time = canonicalInstant(this.now());
    await this.metadataRepository.save({
      version: 1,
      replayId,
      note,
      createdAt: existing?.createdAt ?? time,
      updatedAt: time,
    });
  }

  async export(replayId: string, source: ReplaySourceV1): Promise<string> {
    validateReplayId(replayId);
    validateSource(source);
    let value: unknown;
    let createdAt: string | undefined;
    if (source === 'practice') {
      const bundle = await this.replayRepository.load(replayId);
      value = bundle;
      createdAt = bundle.createdAt;
    } else {
      value = await this.publicRepository.load(replayId);
      const inspection = (await this.publicRepository.inspect())
        .find((item) => item.replayId === replayId && item.state === 'healthy');
      createdAt = inspection?.state === 'healthy' ? inspection.createdAt : undefined;
    }
    if (!createdAt) throw new Error('回放时间不可用。');
    const prefix = source === 'practice' ? '练习赛回放' : '好友房回放';
    const date = createdAt.slice(0, 10).replaceAll('-', '');
    const filename = `${prefix}-${date}-${replayId.slice(0, 8)}.agentic-replay`;
    await atomicJson(resolve(this.exportsRoot, filename), value);
    return filename;
  }

  async moveToTrash(replayId: string, source: ReplaySourceV1): Promise<ReplayTrashEntryV1> {
    validateReplayId(replayId);
    validateSource(source);
    return this.trashRepository.move({
      replayId,
      source,
      replayPath: this.replayPath(replayId, source),
      metadataPath: this.metadataRepository.filePath(replayId),
    });
  }

  async listTrash(): Promise<ReplayTrashCardV1[]> {
    await this.trashRepository.purgeExpired(this.now());
    return Promise.all((await this.trashRepository.list()).map(async (entry) => {
      const raw = await this.trashRepository.loadMetadata(entry.entryId);
      const note = raw === null ? '' : assertReplayMetadataV1(raw).note;
      return { ...entry, note };
    }));
  }

  async restore(entryId: string): Promise<void> {
    const entry = (await this.trashRepository.list()).find((candidate) => candidate.entryId === entryId);
    if (!entry) throw new Error('回收站中没有这场回放。');
    await this.trashRepository.restore(entryId, {
      replayPath: this.replayPath(entry.replayId, entry.source),
      metadataPath: this.metadataRepository.filePath(entry.replayId),
    });
  }

  async emptyTrash(confirmed: boolean): Promise<string[]> {
    if (confirmed !== true) throw new Error('清空回收站需要明确确认。');
    return this.trashRepository.empty(true);
  }

  private async localCandidates(): Promise<Candidate[]> {
    return Promise.all((await this.replayRepository.inspect()).map(async (inspection): Promise<Candidate> => {
      const note = (await this.metadataRepository.load(inspection.bundleHash))?.note ?? '';
      if (inspection.state === 'corrupt') return damaged(inspection.bundleHash, 'practice', note);
      const bundle = await this.replayRepository.load(inspection.bundleHash);
      const studio = createReplayStudioViewV2(bundle);
      const current = studio.participants.find((participant) => participant.teamId === 'current') ?? studio.participants[0];
      return {
        card: {
          replayId: inspection.bundleHash,
          source: 'practice',
          createdAt: studio.createdAt,
          modeName: studio.modeName,
          participantNames: studio.participants.map((participant) => participant.displayName),
          outcome: participantOutcome(current?.outcome),
          ticks: studio.result.ticks,
          note,
          integrity: 'verified',
          playable: true,
        },
        modeId: bundle.config.modeId,
        revisions: studio.participants.flatMap((participant) => revisionFromName(participant.displayName)),
      };
    }));
  }

  private async publicCandidates(): Promise<Candidate[]> {
    return Promise.all((await this.publicRepository.inspect()).map(async (inspection): Promise<Candidate> => {
      const note = (await this.metadataRepository.load(inspection.replayId))?.note ?? '';
      if (inspection.state === 'corrupt') return damaged(inspection.replayId, 'friend-public', note);
      const outcome = inspection.winningTeamIds.length === 0
        ? 'draw'
        : inspection.winningTeamIds.includes(inspection.localTeamId) ? 'victory' : 'defeat';
      return {
        card: {
          replayId: inspection.replayId,
          source: 'friend-public',
          createdAt: inspection.createdAt,
          modeName: inspection.modeName,
          participantNames: [...inspection.participantNames],
          outcome,
          ticks: inspection.ticks,
          note,
          integrity: 'verified',
          playable: true,
        },
        modeId: modeIdFromName(inspection.modeName),
        revisions: [],
      };
    }));
  }

  private replayPath(replayId: string, source: ReplayTrashSourceV1): string {
    return source === 'practice'
      ? this.replayRepository.filePath(replayId)
      : this.publicRepository.filePath(replayId);
  }

  private async ensureExists(replayId: string, source: ReplaySourceV1): Promise<void> {
    if (source === 'practice') await this.replayRepository.load(replayId);
    else await this.publicRepository.load(replayId);
  }
}

function damaged(replayId: string, source: ReplaySourceV1, note: string): Candidate {
  return {
    card: {
      replayId,
      source,
      createdAt: '1970-01-01T00:00:00.000Z',
      modeName: '无法读取',
      participantNames: ['回放已损坏'],
      outcome: 'draw',
      ticks: 0,
      note,
      integrity: 'damaged',
      playable: false,
    },
    revisions: [],
  };
}

function matches(candidate: Candidate, filter: ReplayLibraryFilterV1): boolean {
  const { card } = candidate;
  if (filter.source && card.source !== filter.source) return false;
  if (filter.modeId && candidate.modeId !== filter.modeId) return false;
  if (filter.outcome && card.outcome !== filter.outcome) return false;
  if (filter.buildRevision && !candidate.revisions.includes(filter.buildRevision)) return false;
  if (filter.dateFrom && card.createdAt < `${filter.dateFrom}T00:00:00.000Z`) return false;
  if (filter.dateTo && card.createdAt > `${filter.dateTo}T23:59:59.999Z`) return false;
  if (filter.query) {
    const haystack = `${card.modeName} ${card.participantNames.join(' ')} ${card.note}`.toLocaleLowerCase('zh-CN');
    if (!haystack.includes(filter.query.toLocaleLowerCase('zh-CN'))) return false;
  }
  return true;
}

function normalizeFilter(value: ReplayLibraryFilterV1): ReplayLibraryFilterV1 {
  if (!value || typeof value !== 'object') throw new Error('回放筛选条件无效。');
  if (value.source !== undefined) validateSource(value.source);
  if (value.modeId !== undefined && value.modeId !== 'duel' && value.modeId !== 'capture') throw new Error('回放模式筛选无效。');
  if (value.outcome !== undefined && !['victory', 'defeat', 'draw'].includes(value.outcome)) throw new Error('回放结果筛选无效。');
  if (value.buildRevision !== undefined && (!Number.isSafeInteger(value.buildRevision) || value.buildRevision < 1)) throw new Error('回放版本筛选无效。');
  if (value.query !== undefined && (typeof value.query !== 'string' || value.query.trim() !== value.query || value.query.length > 80)) throw new Error('回放搜索内容无效。');
  for (const date of [value.dateFrom, value.dateTo]) {
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('回放日期筛选无效。');
  }
  return { ...value };
}

function validateReplayId(value: string): void {
  if (!SHA256.test(value)) throw new Error('回放编号无效。');
}

function validateSource(value: string): asserts value is ReplaySourceV1 {
  if (value !== 'practice' && value !== 'friend-public') throw new Error('回放来源无效。');
}

function canonicalInstant(value: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('回放时间无效。');
  }
  return value;
}

function participantOutcome(value: 'winner' | 'defeated' | 'draw' | undefined): ReplayOutcomeV1 {
  return value === 'winner' ? 'victory' : value === 'defeated' ? 'defeat' : 'draw';
}

function revisionFromName(value: string): number[] {
  const match = / r(\d+)$/.exec(value);
  return match ? [Number(match[1])] : [];
}

function modeIdFromName(value: string): string | undefined {
  return value === '歼灭决斗' ? 'duel' : value === '据点争夺' ? 'capture' : undefined;
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
