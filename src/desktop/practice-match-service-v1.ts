import { SavedBuildRepositoryV2 } from '../config/saved-build-repository-v2.js';
import type { SavedBuildV2 } from '../config/saved-build-v2.js';
import { GAMEPLAY_CONTENT_V2, GAMEPLAY_MAP_FRONTIER_V2 } from '../core/v2/gameplay-content.js';
import { runPracticeMatchV2 } from '../practice/run-practice-match-v2.js';
import { ReplayRepositoryV2 } from '../replay/repository-v2.js';
import { createReplayStudioViewV2, type ReplayStudioMomentV2 } from '../replay/studio-v2.js';
import { COMMANDER_BUILD_ID_V1 } from './garage-service-v1.js';

export interface PracticeRunInputV1 {
  currentRevision: number;
  opponentRevision: number;
  modeId: 'duel' | 'capture';
  seed?: number;
}

export interface PracticeResultViewV1 {
  replayHash: string;
  currentRevision: number;
  opponentRevision: number;
  outcome: 'victory' | 'defeat' | 'draw';
  modeName: string;
  ticks: number;
  moments: Array<{ tick: number; title: string; summary: string }>;
}

export interface PracticeMatchServiceOptionsV1 {
  buildRepository: SavedBuildRepositoryV2;
  replayRepository: ReplayRepositoryV2;
  now?: () => string;
}

export class PracticeMatchServiceV1 {
  private active?: AbortController;
  private readonly buildRepository: SavedBuildRepositoryV2;
  private readonly replayRepository: ReplayRepositoryV2;
  private readonly now: () => string;

  constructor(options: PracticeMatchServiceOptionsV1) {
    this.buildRepository = options.buildRepository;
    this.replayRepository = options.replayRepository;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  cancel(): void { this.active?.abort(new Error('练习已取消，未完成的比赛不会保存。')); }

  async run(input: PracticeRunInputV1, signal?: AbortSignal): Promise<PracticeResultViewV1> {
    const normalized = validateInput(input);
    if (this.active) throw new Error('练习赛正在进行，请等待完成或取消。');
    const controller = new AbortController();
    this.active = controller;
    const cancel = () => controller.abort(signal?.reason ?? new Error('练习已取消。'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
    controller.signal.throwIfAborted();
    const inspection = await this.buildRepository.inspect(COMMANDER_BUILD_ID_V1);
    const current = healthyRevision(inspection.revisions, normalized.currentRevision);
    const opponent = healthyRevision(inspection.revisions, normalized.opponentRevision);
    const createdAt = canonicalNow(this.now());
    const output = await runPracticeMatchV2({
      current,
      opponent,
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      modeId: normalized.modeId,
      seed: normalized.seed ?? Date.parse(createdAt),
      maxTicks: 120,
      createdAt,
      tickBudgetMs: 100,
      collectLogs: false,
      signal: controller.signal,
    });
    controller.signal.throwIfAborted();
    const saved = await this.replayRepository.save(output.bundle);
    const studio = createReplayStudioViewV2(saved.bundle);
    const currentParticipant = studio.participants.find((participant) => participant.teamId === 'current');
    if (!currentParticipant) throw new Error('练习赛结果缺少玩家队伍。');
    return {
      replayHash: saved.bundle.integrity.bundleHash,
      currentRevision: normalized.currentRevision,
      opponentRevision: normalized.opponentRevision,
      outcome: currentParticipant.outcome === 'winner'
        ? 'victory'
        : currentParticipant.outcome === 'defeated'
          ? 'defeat'
          : 'draw',
      modeName: studio.modeName,
      ticks: studio.result.ticks,
      moments: selectMoments(studio.moments).map(({ tick, title, summary }) => ({ tick, title, summary })),
    };
    } finally { signal?.removeEventListener('abort', cancel); this.active = undefined; }
  }
}

function validateInput(input: PracticeRunInputV1): Required<PracticeRunInputV1> | Omit<Required<PracticeRunInputV1>, 'seed'> & { seed?: number } {
  if (!input || typeof input !== 'object') throw new Error('练习赛配置无效。');
  assertRevision(input.currentRevision);
  assertRevision(input.opponentRevision);
  if (input.modeId !== 'duel' && input.modeId !== 'capture') throw new Error('请选择可用的比赛模式。');
  if (input.seed !== undefined && (!Number.isSafeInteger(input.seed) || input.seed < 0)) {
    throw new Error('练习赛随机种子无效。');
  }
  return {
    currentRevision: input.currentRevision,
    opponentRevision: input.opponentRevision,
    modeId: input.modeId,
    ...(input.seed === undefined ? {} : { seed: input.seed >>> 0 }),
  };
}

function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('练习赛版本无效。');
}

function healthyRevision(
  revisions: Awaited<ReturnType<SavedBuildRepositoryV2['inspect']>>['revisions'],
  revision: number,
): SavedBuildV2 {
  const selected = revisions.find((candidate) => candidate.revision === revision);
  if (!selected || selected.state !== 'healthy') throw new Error(`版本 r${revision} 不可用于练习赛。`);
  return selected.record;
}

function canonicalNow(value: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('练习赛时间无效。');
  }
  return value;
}

function selectMoments(moments: readonly ReplayStudioMomentV2[]): ReplayStudioMomentV2[] {
  if (moments.length <= 3) return [...moments];
  const first = moments[0]!;
  const last = moments[moments.length - 1]!;
  const highlight = moments.slice(1, -1).find((moment) => moment.kind !== 'system') ?? moments[1]!;
  return [first, highlight, last];
}
