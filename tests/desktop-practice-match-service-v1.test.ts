import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SavedBuildRepositoryV2 } from '../src/config/saved-build-repository-v2.js';
import { BuildRevisionNoteRepositoryV1 } from '../src/desktop/build-revision-note-repository-v1.js';
import { GarageServiceV1 } from '../src/desktop/garage-service-v1.js';
import type { PlayerProfileV1 } from '../src/desktop/player-profile-v1.js';
import { PracticeMatchServiceV1 } from '../src/desktop/practice-match-service-v1.js';
import { ReplayRepositoryV2 } from '../src/replay/repository-v2.js';
import { verifyMatchBundleV2 } from '../src/replay/v2.js';

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

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'agentic-game-desktop-practice-'));
  roots.push(root);
  let clock = 0;
  const now = () => `2026-09-01T01:${String(clock++).padStart(2, '0')}:00.000Z`;
  const quarantineRoot = join(root, 'quarantine');
  const buildRepository = new SavedBuildRepositoryV2(join(root, 'builds'), { quarantineRoot, now });
  const noteRepository = new BuildRevisionNoteRepositoryV1(join(root, 'build-metadata'), { quarantineRoot, now });
  const replayRepository = new ReplayRepositoryV2(join(root, 'replays'));
  const garage = new GarageServiceV1({
    buildRepository,
    noteRepository,
    replayRepository,
    diagnosticsRoot: join(root, 'diagnostics'),
    now,
  });
  const service = new PracticeMatchServiceV1({ buildRepository, replayRepository, now });
  return { root, buildRepository, replayRepository, garage, service };
}

async function createTwoRevisions(setupResult: ReturnType<typeof setup>): Promise<void> {
  await setupResult.garage.getSnapshot(player());
  await setupResult.garage.saveRevision(player(), {
    label: '侧翼突击',
    vehicleId: 'scout',
    weaponId: 'light-cannon',
    tacticId: 'scout',
    note: '提高侧翼机动性',
  });
}

describe('PracticeMatchServiceV1', () => {
  it('cancels an active match without publishing a replay and permits the next run', async () => {
    const context = setup();
    await context.garage.getSnapshot(player());
    const input = { currentRevision: 1, opponentRevision: 1, modeId: 'duel' as const, seed: 19 };
    const running = context.service.run(input);
    await expect(context.service.run(input)).rejects.toThrow('正在进行');
    context.service.cancel();
    await expect(running).rejects.toThrow('取消');
    expect(await context.replayRepository.list()).toEqual([]);
    expect((await context.service.run(input)).ticks).toBeGreaterThan(0);
  });
  it('runs current versus old through the real worker and persists one verified replay', async () => {
    const context = setup();
    await createTwoRevisions(context);

    const result = await context.service.run({
      currentRevision: 2,
      opponentRevision: 1,
      modeId: 'capture',
      seed: 4_294_967_297,
    });
    const entries = await context.replayRepository.list();
    const bundle = await context.replayRepository.load(result.replayHash);

    expect(result).toEqual({
      replayHash: bundle.integrity.bundleHash,
      currentRevision: 2,
      opponentRevision: 1,
      outcome: expect.stringMatching(/^(victory|defeat|draw)$/),
      modeName: '据点争夺',
      ticks: expect.any(Number),
      moments: expect.any(Array),
    });
    expect(result.moments.length).toBeGreaterThan(0);
    expect(result.moments.length).toBeLessThanOrEqual(3);
    expect(entries).toHaveLength(1);
    expect(bundle.config.seed).toBe(1);
    expect(bundle.config.maxTicks).toBe(120);
    expect(bundle.config.modeId).toBe('capture');
    expect(verifyMatchBundleV2(bundle)).toEqual({ ok: true, issues: [] });
    expect(JSON.stringify(result)).not.toMatch(/module\.exports|actions|logs|seed|codeHash|botArtifacts/);
  });

  it('supports a deterministic mirror run without duplicating the saved bot artifact', async () => {
    const context = setup();
    await context.garage.getSnapshot(player());

    const result = await context.service.run({
      currentRevision: 1,
      opponentRevision: 1,
      modeId: 'duel',
      seed: 19,
    });
    const bundle = await context.replayRepository.load(result.replayHash);

    expect(result).toMatchObject({
      currentRevision: 1,
      opponentRevision: 1,
      modeName: '歼灭决斗',
    });
    expect(bundle.botArtifacts).toHaveLength(1);
    expect(bundle.config.teams[0]!.bot).toEqual(bundle.config.teams[1]!.bot);
  });

  it('rejects missing or corrupt revisions before writing any replay', async () => {
    const context = setup();
    await createTwoRevisions(context);
    const file = join(context.root, 'builds', 'commander-main', '2.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('light-cannon', 'heavy-cannon'), 'utf8');

    await expect(context.service.run({
      currentRevision: 2,
      opponentRevision: 1,
      modeId: 'duel',
    })).rejects.toThrow('不可用于练习赛');
    await expect(context.service.run({
      currentRevision: 1,
      opponentRevision: 99,
      modeId: 'duel',
    })).rejects.toThrow('不可用于练习赛');
    expect(await context.replayRepository.list()).toEqual([]);
  });
});
