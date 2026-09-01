import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SavedBuildRepositoryV2 } from '../src/config/saved-build-repository-v2.js';
import { BuildRevisionNoteRepositoryV1 } from '../src/desktop/build-revision-note-repository-v1.js';
import { GarageServiceV1 } from '../src/desktop/garage-service-v1.js';
import type { PlayerProfileV1 } from '../src/desktop/player-profile-v1.js';
import { PracticeMatchServiceV1 } from '../src/desktop/practice-match-service-v1.js';
import {
  ReplayLibraryServiceV1,
  type PublicReplayLibraryRepositoryV1,
} from '../src/desktop/replay-library-service-v1.js';
import { ReplayMetadataRepositoryV1 } from '../src/desktop/replay-metadata-repository-v1.js';
import { ReplayTrashRepositoryV1 } from '../src/desktop/replay-trash-repository-v1.js';
import { createFriendRoomReplayV1, type FriendRoomReplayV1 } from '../src/friend-room/replay-v1.js';
import { ReplayRepositoryV2 } from '../src/replay/repository-v2.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function player(): PlayerProfileV1 {
  return {
    version: 1,
    playerId: '11111111-1111-4111-8111-111111111111',
    displayName: '乐淳',
    doctrine: 'medium',
    tutorialStage: 'complete',
    recentPage: 'practice',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastOpenedAt: '2026-09-01T00:00:00.000Z',
  };
}

class MemoryPublicReplays implements PublicReplayLibraryRepositoryV1 {
  readonly records = new Map<string, { replay: FriendRoomReplayV1; createdAt: string; localTeamId: string }>();
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async inspect() {
    return [...this.records].map(([replayId, record]) => ({
      replayId,
      state: 'healthy' as const,
      createdAt: record.createdAt,
      localTeamId: record.localTeamId,
      modeName: record.replay.modeName,
      participantNames: record.replay.participants.map((participant) => participant.displayName),
      winningTeamIds: [...record.replay.result.winningTeamIds],
      ticks: record.replay.result.ticks,
    }));
  }

  async load(replayId: string) {
    const record = this.records.get(replayId);
    if (!record) throw new Error('Public replay not found');
    return structuredClone(record.replay);
  }

  filePath(replayId: string) {
    return join(this.root, `${replayId}.json`);
  }
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'agentic-game-replay-library-'));
  roots.push(root);
  let minute = 0;
  const now = () => `2026-09-01T0${Math.min(minute++, 9)}:00:00.000Z`;
  const buildRepository = new SavedBuildRepositoryV2(join(root, 'builds'), {
    quarantineRoot: join(root, 'quarantine'), now,
  });
  const noteRepository = new BuildRevisionNoteRepositoryV1(join(root, 'build-notes'), {
    quarantineRoot: join(root, 'quarantine'), now,
  });
  const replayRepository = new ReplayRepositoryV2(join(root, 'replays'));
  const garage = new GarageServiceV1({
    buildRepository, noteRepository, replayRepository,
    diagnosticsRoot: join(root, 'diagnostics'), now,
  });
  const practice = new PracticeMatchServiceV1({ buildRepository, replayRepository, now });
  await garage.getSnapshot(player());
  await garage.saveRevision(player(), {
    label: '侧翼突击', vehicleId: 'scout', weaponId: 'light-cannon', tacticId: 'scout', note: '机动作战',
  });
  const duel = await practice.run({ currentRevision: 1, opponentRevision: 1, modeId: 'duel', seed: 7 });
  const capture = await practice.run({ currentRevision: 2, opponentRevision: 1, modeId: 'capture', seed: 8 });
  const publicRepository = new MemoryPublicReplays(join(root, 'public'));
  const publicId = 'f'.repeat(64);
  const publicReplay = createFriendRoomReplayV1(await replayRepository.load(duel.replayHash));
  publicRepository.records.set(publicId, {
    replay: publicReplay, createdAt: '2026-09-01T09:00:00.000Z', localTeamId: 'current',
  });
  mkdirSync(publicRepository.root, { recursive: true });
  writeFileSync(publicRepository.filePath(publicId), `${JSON.stringify(publicReplay)}\n`, 'utf8');
  const metadataRepository = new ReplayMetadataRepositoryV1(join(root, 'replay-notes'));
  const trashRepository = new ReplayTrashRepositoryV1(join(root, 'trash'), { now });
  const service = new ReplayLibraryServiceV1({
    replayRepository, publicRepository, metadataRepository, trashRepository,
    exportsRoot: join(root, 'exports'), now,
  });
  return { root, service, replayRepository, publicId, duel, capture };
}

describe('ReplayLibraryServiceV1', () => {
  it('lists real local and public replays, isolates damage and applies player-facing filters', async () => {
    const context = await setup();
    const corruptId = context.capture.replayHash;
    const corruptPath = context.replayRepository.filePath(corruptId);
    writeFileSync(corruptPath, readFileSync(corruptPath, 'utf8').replace('据点争夺', '损坏模式'), 'utf8');

    const all = await context.service.list({});
    expect(all.cards).toHaveLength(3);
    expect(all.counts).toEqual({ all: 3, practice: 2, friendPublic: 1, damaged: 1, trash: 0 });
    expect(all.cards[0]).toMatchObject({ replayId: context.publicId, source: 'friend-public', integrity: 'verified' });
    expect(all.cards.find((card) => card.replayId === corruptId)).toMatchObject({
      source: 'practice', integrity: 'damaged', playable: false,
    });
    const duelCards = (await context.service.list({ modeId: 'duel', buildRevision: 1 })).cards;
    expect(duelCards).toHaveLength(1);
    expect((await context.service.list({ modeId: 'duel', outcome: duelCards[0]!.outcome })).cards.length)
      .toBeGreaterThanOrEqual(1);
    expect((await context.service.list({ query: '侧翼突击' })).cards).toHaveLength(0);
    expect(JSON.stringify(all)).not.toMatch(/module\.exports|botArtifacts|actions|logs|codeHash|bundleHash|seed|\.json/);
  });

  it('opens only verified projections, updates notes, exports inside the app root and restores trash', async () => {
    const context = await setup();
    const opened = await context.service.open(context.duel.replayHash, 'practice');
    expect(opened.replay.frames.length).toBeGreaterThan(1);
    expect(JSON.stringify(opened)).not.toMatch(/module\.exports|botArtifacts|actions|logs|codeHash|bundleHash|seed/);

    await context.service.updateNote(context.duel.replayHash, 'practice', '注意第一轮转向');
    expect((await context.service.list({ query: '第一轮' })).cards).toHaveLength(1);
    const exported = await context.service.export(context.duel.replayHash, 'practice');
    expect(exported).toMatch(/^练习赛回放-\d{8}-[0-9a-f]{8}\.agentic-replay$/);
    expect(existsSync(join(context.root, 'exports', exported))).toBe(true);

    const entry = await context.service.moveToTrash(context.duel.replayHash, 'practice');
    expect((await context.service.list({})).counts.trash).toBe(1);
    expect(await context.service.listTrash()).toEqual([
      expect.objectContaining({ entryId: entry.entryId, source: 'practice', note: '注意第一轮转向' }),
    ]);
    await context.service.restore(entry.entryId);
    expect((await context.service.list({ query: '第一轮' })).cards).toHaveLength(1);
    await expect(context.service.emptyTrash(false)).rejects.toThrow('需要明确确认');
  });
});
