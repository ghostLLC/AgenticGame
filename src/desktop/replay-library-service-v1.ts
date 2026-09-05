import { mkdir, stat } from 'node:fs/promises';
import { mapLimited } from '../storage/map-limited.js';
import { writeAtomicJson as atomicJson } from '../storage/atomic-json.js';
import { readBoundedFile } from '../storage/read-bounded-file.js';
import { basename, resolve } from 'node:path';
import { assertFriendRoomReplayV1, createFriendRoomReplayV1, type FriendRoomReplayV1 } from '../friend-room/replay-v1.js';
import { hashJson, type JsonValue } from '../core/v2/json.js';
import type { MatchBundleV2 } from '../replay/v2.js';
import { ReplayRepositoryV2 } from '../replay/repository-v2.js';
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
  offset?: number;
  limit?: number;
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
  noteIssue?: string;
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
  save?(input: { replay: FriendRoomReplayV1; createdAt: string; localTeamId: string; completionKey: string }): Promise<{ created: boolean; replayId: string }>;
}

export interface ReplayLibraryOptionsV1 {
  replayRepository: ReplayRepositoryV2;
  publicRepository: PublicReplayLibraryRepositoryV1;
  metadataRepository: ReplayMetadataRepositoryV1;
  trashRepository: ReplayTrashRepositoryV1;
  exportsRoot: string;
  now?: () => string;
  chooseExportPath?: (filename: string, privateBackup: boolean) => Promise<string | undefined>;
  chooseImportPath?: () => Promise<string | undefined>;
  revealExport?: (path: string) => void;
}

export interface ReplayLibrarySnapshotV1 {
  cards: ReplayCardV1[];
  recoveryNotice?: string;
  totalFiltered?: number;
  hasMore?: boolean;
  counts: { all: number; practice: number; friendPublic: number; damaged: number; trash: number };
}

export interface ReplayTrashCardV1 extends ReplayTrashEntryV1 {
  note: string;
  noteIssue?: string;
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
  private lastExportPath?: string;

  constructor(private readonly options: ReplayLibraryOptionsV1) {
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
    const trash = await this.trashRepository.inspect();
    const filtered = candidates.filter((candidate) => matches(candidate, normalized));
    const offset = normalized.offset ?? 0;
    const limit = normalized.limit ?? 40;
    return {
      cards: filtered.slice(offset, offset + limit).map((candidate) => candidate.card),
      ...(trash.damagedCount ? { recoveryNotice: `回收站中有 ${trash.damagedCount} 条记录需要恢复。原文件已保留，健康回放不受影响；请保留玩家资料目录并联系维护者。` } : {}),
      totalFiltered: filtered.length,
      hasMore: offset + limit < filtered.length,
      counts: {
        all: candidates.length,
        practice: candidates.filter((candidate) => candidate.card.source === 'practice').length,
        friendPublic: candidates.filter((candidate) => candidate.card.source === 'friend-public').length,
        damaged: candidates.filter((candidate) => candidate.card.integrity === 'damaged').length,
        trash: trash.entries.length,
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
    const existing = await this.metadataRepository.load(replayId).catch(() => undefined);
    const time = canonicalInstant(this.now());
    await this.metadataRepository.save({
      version: 1,
      replayId,
      note,
      createdAt: existing?.createdAt ?? time,
      updatedAt: time,
    });
  }

  async export(replayId: string, source: ReplaySourceV1, privateBackup = false): Promise<string> {
    validateReplayId(replayId);
    validateSource(source);
    let value: unknown;
    let createdAt: string | undefined;
    let localTeamId = 'current';
    if (privateBackup && source !== 'practice') throw new Error('公开回放不包含完整战术备份。');
    if (source === 'practice') {
      const bundle = await this.replayRepository.load(replayId);
      value = privateBackup ? bundle : createFriendRoomReplayV1(bundle);
      localTeamId = bundle.config.teams.find((team) => team.teamId === 'current')?.teamId ?? bundle.config.teams[0]!.teamId;
      createdAt = bundle.createdAt;
    } else {
      value = await this.publicRepository.load(replayId);
      const inspection = (await this.publicRepository.inspect())
        .find((item) => item.replayId === replayId && item.state === 'healthy');
      createdAt = inspection?.state === 'healthy' ? inspection.createdAt : undefined;
      if (inspection?.state === 'healthy') localTeamId = inspection.localTeamId;
    }
    if (!createdAt) throw new Error('回放时间不可用。');
    const prefix = source === 'practice' ? '练习赛回放' : '好友房回放';
    const date = createdAt.slice(0, 10).replaceAll('-', '');
    const filename = `${privateBackup ? '完整备份' : prefix}-${date}-${replayId.slice(0, 8)}.${privateBackup ? 'agentic-backup' : 'agentic-replay'}`;
    if (!privateBackup) {
      const payload = { replay: value, createdAt, localTeamId };
      value = { format: 'agentic-public-replay', version: 1, payload, checksum: hashJson(payload as JsonValue) };
    }
    const target = this.options.chooseExportPath ? await this.options.chooseExportPath(filename, privateBackup) : resolve(this.exportsRoot, filename);
    if (!target) return '';
    await atomicJson(target, value);
    this.lastExportPath = target;
    return basename(target);
  }

  async importFile(): Promise<string> {
    const path = await this.options.chooseImportPath?.();
    if (!path) return '';
    if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error('回放文件超过 16 MiB，无法导入。');
    const bytes = await readBoundedFile(path, 16 * 1024 * 1024);
    if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('回放文件超过大小限制。');
    let value: any;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('回放文件内容无法读取。'); }
    if (value?.version === 2 && value?.integrity) {
      await this.replayRepository.save(value as MatchBundleV2);
    } else {
      let replay: FriendRoomReplayV1; let createdAt = this.now(); let localTeamId: string;
      if (value?.format === 'agentic-public-replay' && value.version === 1) {
        if (value.checksum !== hashJson(value.payload as JsonValue)) throw new Error('回放文件校验失败。');
        replay = assertFriendRoomReplayV1(value.payload.replay);
        createdAt = canonicalInstant(value.payload.createdAt);
        localTeamId = value.payload.localTeamId;
      } else {
        replay = assertFriendRoomReplayV1(value);
        localTeamId = replay.participants[0]!.teamId;
      }
      if (!this.publicRepository.save) throw new Error('回放导入功能暂不可用。');
      await this.publicRepository.save({ replay, createdAt, localTeamId, completionKey: hashJson({ replay, createdAt, localTeamId } as unknown as JsonValue) });
    }
    return basename(path);
  }

  async revealLastExport(): Promise<void> {
    if (!this.lastExportPath) await mkdir(this.exportsRoot, { recursive: true });
    this.options.revealExport?.(this.lastExportPath ?? this.exportsRoot);
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
      try {
        const raw = await this.trashRepository.loadMetadata(entry.entryId);
        const note = raw === null ? '' : assertReplayMetadataV1(raw).note;
        return { ...entry, note };
      } catch { return { ...entry, note: '', noteIssue: '说明损坏；回放仍可恢复。' }; }
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

  async exportDiagnostic(): Promise<string> {
    const snapshot = await this.list({});
    const createdAt = canonicalInstant(this.now());
    const filename = `回放诊断-${createdAt.slice(0, 10).replaceAll('-', '')}.json`;
    await atomicJson(resolve(this.exportsRoot, filename), {
      version: 1,
      createdAt,
      counts: snapshot.counts,
      entries: snapshot.cards.map((card) => ({
        source: card.source,
        createdAt: card.createdAt,
        modeName: card.modeName,
        outcome: card.outcome,
        ticks: card.ticks,
        integrity: card.integrity,
      })),
    });
    return filename;
  }

  private async localCandidates(): Promise<Candidate[]> {
    return mapLimited(await this.replayRepository.inspect(), 8, async (inspection): Promise<Candidate> => {
      const annotation = await this.safeNote(inspection.bundleHash);
      if (inspection.state === 'corrupt') return damaged(inspection.bundleHash, 'practice', annotation.note);
      const entry = inspection.entry;
      const current = entry.teams.find((participant) => participant.teamId === 'current') ?? entry.teams[0];
      return {
        card: {
          replayId: inspection.bundleHash,
          source: 'practice',
          createdAt: entry.createdAt,
          modeName: entry.modeName,
          participantNames: entry.teamNames,
          outcome: entry.winningTeamIds.length === 0 ? 'draw' : entry.winningTeamIds.includes(current?.teamId ?? '') ? 'victory' : 'defeat',
          ticks: entry.ticks,
          ...annotation,
          integrity: 'verified',
          playable: true,
        },
        modeId: entry.modeId,
        revisions: entry.teamNames.flatMap(revisionFromName),
      };
    });
  }

  private async publicCandidates(): Promise<Candidate[]> {
    return mapLimited(await this.publicRepository.inspect(), 8, async (inspection): Promise<Candidate> => {
      const annotation = await this.safeNote(inspection.replayId);
      if (inspection.state === 'corrupt') return damaged(inspection.replayId, 'friend-public', annotation.note);
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
          ...annotation,
          integrity: 'verified',
          playable: true,
        },
        modeId: modeIdFromName(inspection.modeName),
        revisions: [],
      };
    });
  }

  private replayPath(replayId: string, source: ReplayTrashSourceV1): string {
    return source === 'practice'
      ? this.replayRepository.filePath(replayId)
      : this.publicRepository.filePath(replayId);
  }

  private async safeNote(replayId: string): Promise<{ note: string; noteIssue?: string }> {
    try { return { note: (await this.metadataRepository.load(replayId))?.note ?? '' }; }
    catch { return { note: '', noteIssue: '说明损坏；回放仍可播放，保存新说明即可修复。' }; }
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
  if (value.offset !== undefined && (!Number.isSafeInteger(value.offset) || value.offset < 0)) throw new Error('回放页码无效。');
  if (value.limit !== undefined && (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100)) throw new Error('每页最多显示 100 场回放。');
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

function revisionFromName(value: string): number[] {
  const match = / r(\d+)$/.exec(value);
  return match ? [Number(match[1])] : [];
}

function modeIdFromName(value: string): string | undefined {
  return value === '歼灭决斗' ? 'duel' : value === '据点争夺' ? 'capture' : undefined;
}
