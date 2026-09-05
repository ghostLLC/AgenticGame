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
import { PublicReplayRepositoryV1 } from '../src/desktop/public-replay-repository-v1.js';
import { createMatchBundleV2 } from '../src/replay/v2.js';

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
  it('paginates after filtering while reporting complete counts', async () => {
    const context = await setup();
    const original = await context.replayRepository.load(context.duel.replayHash);
    for (let index = 0; index < 6; index++) {
      await context.replayRepository.save(createMatchBundleV2({ ...original, config: { ...original.config, matchId: `pagination-${index}` },
        createdAt: new Date(Date.parse('2026-09-02T00:00:00.000Z') + index * 1000).toISOString() }));
    }
    const first = await context.service.list({ source: 'practice', limit: 5 });
    const next = await context.service.list({ source: 'practice', offset: 5, limit: 5 });
    expect(first.cards).toHaveLength(5);
    expect(first).toMatchObject({ hasMore: true, totalFiltered: 8, counts: { all: 9 } });
    expect(next.cards).toHaveLength(3);
    expect(next.hasMore).toBe(false);
    expect(new Set([...first.cards, ...next.cards].map((card) => card.replayId)).size).toBe(8);
    await expect(context.service.list({ limit: 101 })).rejects.toThrow('100');
  }, 15_000); // Includes two real worker matches and durable fixture writes under suite contention.
  it('round-trips public files and explicit private backups, deduplicates imports and rejects tampering', async () => {
    const context = await setup();
    const publicName = await context.service.export(context.duel.replayHash, 'practice');
    const backupName = await context.service.export(context.duel.replayHash, 'practice', true);
    expect(readFileSync(join(context.root, 'exports', publicName), 'utf8')).not.toContain('module.exports');
    expect(readFileSync(join(context.root, 'exports', backupName), 'utf8')).toContain('module.exports');
    let selected = join(context.root, 'exports', publicName);
    const receiver = new ReplayLibraryServiceV1({
      replayRepository: new ReplayRepositoryV2(join(context.root, 'receiver-private')),
      publicRepository: new PublicReplayRepositoryV1(join(context.root, 'receiver-public')),
      metadataRepository: new ReplayMetadataRepositoryV1(join(context.root, 'receiver-notes')),
      trashRepository: new ReplayTrashRepositoryV1(join(context.root, 'receiver-trash')),
      exportsRoot: join(context.root, 'receiver-exports'), chooseImportPath: async () => selected,
      chooseExportPath: async () => undefined,
    });
    await receiver.importFile(); await receiver.importFile();
    expect((await receiver.list({})).counts).toMatchObject({ all: 1, friendPublic: 1 });
    selected = join(context.root, 'exports', backupName); await receiver.importFile();
    expect((await receiver.list({})).counts).toMatchObject({ all: 2, practice: 1 });
    expect(await receiver.export(context.duel.replayHash, 'practice')).toBe('');
    selected = join(context.root, 'exports', publicName);
    const corrupted = JSON.parse(readFileSync(selected, 'utf8')); corrupted.payload.createdAt = '2020-01-01T00:00:00.000Z';
    writeFileSync(selected, JSON.stringify(corrupted));
    await expect(receiver.importFile()).rejects.toThrow('校验失败');
  });
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
    expect(readFileSync(join(context.root, 'exports', exported), 'utf8')).not.toMatch(/module\.exports|botArtifacts|actions|logs|codeHash|bundleHash|seed/);

    const entry = await context.service.moveToTrash(context.duel.replayHash, 'practice');
    expect((await context.service.list({})).counts.trash).toBe(1);
    expect(await context.service.listTrash()).toEqual([
      expect.objectContaining({ entryId: entry.entryId, source: 'practice', note: '注意第一轮转向' }),
    ]);
    await context.service.restore(entry.entryId);
    expect((await context.service.list({ query: '第一轮' })).cards).toHaveLength(1);
    await expect(context.service.emptyTrash(false)).rejects.toThrow('需要明确确认');
  });

  it('isolates corrupt notes in both the library and trash, and preserves the bad file when repairing', async () => {
    const context = await setup();
    const notesRoot = join(context.root, 'replay-notes'); mkdirSync(notesRoot, { recursive: true });
    writeFileSync(join(notesRoot, `${context.duel.replayHash}.json`), '{');
    const cards = (await context.service.list({})).cards;
    expect(cards).toHaveLength(3);
    expect(cards.find((card) => card.replayId === context.duel.replayHash)).toMatchObject({ playable: true, noteIssue: expect.any(String) });
    const entry = await context.service.moveToTrash(context.duel.replayHash, 'practice');
    expect((await context.service.listTrash())[0]).toMatchObject({ entryId: entry.entryId, noteIssue: expect.any(String) });
    await context.service.restore(entry.entryId);
    await context.service.updateNote(context.duel.replayHash, 'practice', '修复后的说明');
    expect((await context.service.list({ query: '修复后的说明' })).cards).toHaveLength(1);
  });
});
