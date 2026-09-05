import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SavedBuildRepositoryV2 } from '../src/config/saved-build-repository-v2.js';
import { GAMEPLAY_CONTENT_V2, GAMEPLAY_MAP_FRONTIER_V2 } from '../src/core/v2/gameplay-content.js';
import { runPracticeMatchV2 } from '../src/practice/run-practice-match-v2.js';
import { ReplayRepositoryV2 } from '../src/replay/repository-v2.js';
import { BuildRevisionNoteRepositoryV1 } from '../src/desktop/build-revision-note-repository-v1.js';
import { GarageServiceV1, type GarageSaveInputV1 } from '../src/desktop/garage-service-v1.js';
import type { PlayerProfileV1 } from '../src/desktop/player-profile-v1.js';

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
    recentPage: 'garage',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastOpenedAt: '2026-09-01T00:00:00.000Z',
  };
}

function changedInput(): GarageSaveInputV1 {
  return {
    label: '侧翼突击',
    vehicleId: 'scout',
    weaponId: 'light-cannon',
    tacticId: 'scout',
    note: '提高侧翼机动性',
    replaceTactic: true,
  };
}

function setup(): {
  root: string;
  service: GarageServiceV1;
  buildRepository: SavedBuildRepositoryV2;
  noteRepository: BuildRevisionNoteRepositoryV1;
  replayRepository: ReplayRepositoryV2;
} {
  const root = mkdtempSync(join(tmpdir(), 'agentic-game-garage-'));
  roots.push(root);
  let clock = 0;
  const now = () => `2026-09-01T00:0${clock++}:00.000Z`;
  const quarantineRoot = join(root, 'quarantine');
  const buildRepository = new SavedBuildRepositoryV2(join(root, 'builds'), { quarantineRoot, now });
  const noteRepository = new BuildRevisionNoteRepositoryV1(join(root, 'build-metadata'), { quarantineRoot, now });
  const replayRepository = new ReplayRepositoryV2(join(root, 'replays'));
  const service = new GarageServiceV1({
    buildRepository,
    noteRepository,
    replayRepository,
    diagnosticsRoot: join(root, 'diagnostics'),
    now,
  });
  return { root, service, buildRepository, noteRepository, replayRepository };
}

describe('GarageServiceV1', () => {
  it('seeds one private commander build from the completed player doctrine', async () => {
    const { service } = setup();

    const snapshot = await service.getSnapshot(player());

    expect(snapshot).toMatchObject({
      status: 'ready',
      currentRevision: 1,
      vehicles: [
        { id: 'scout', name: '侦察坦克', compatibleWeaponIds: ['light-cannon'] },
        { id: 'medium', name: '中型坦克', compatibleWeaponIds: ['medium-cannon'] },
        { id: 'heavy', name: '重型坦克', compatibleWeaponIds: ['heavy-cannon'] },
      ],
      revisions: [{
        revision: 1,
        state: 'healthy',
        label: '乐淳的主力战车',
        vehicleName: '中型坦克',
        weaponName: '中型炮',
        tacticName: '中线突击',
        note: '首次作战配置',
        selectable: true,
      }],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/module\.exports|[0-9a-f]{64}/);
  });

  it('creates a player-readable immutable revision and deduplicates an unchanged save', async () => {
    const { service, noteRepository } = setup();
    await service.getSnapshot(player());

    const changed = await service.saveRevision(player(), changedInput());
    const unchanged = await service.saveRevision(player(), changedInput());

    expect(changed.currentRevision).toBe(2);
    expect(changed.revisions[1]).toMatchObject({
      revision: 2,
      label: '侧翼突击',
      tacticName: '游骑侦察',
      note: '提高侧翼机动性',
      changes: [
        '版本名称：乐淳的主力战车 → 侧翼突击',
        '战车：中型坦克 → 侦察坦克',
        '主炮：中型炮 → 轻型炮',
        '战术：中线突击 → 游骑侦察',
        '更新战术代码',
      ],
    });
    expect(unchanged.revisions).toHaveLength(2);
    expect(await noteRepository.list('commander-main')).toHaveLength(2);
  });

  it('preserves external source and equipment for ordinary edits, including note-only saves', async () => {
    const { service, buildRepository, noteRepository } = setup();
    await service.getSnapshot(player());
    const first = await buildRepository.load('commander-main', 'latest');
    const source = 'module.exports = () => ({ onTick() { return { throttle: 0, fire: true }; } });';
    await buildRepository.save({ buildId: first.buildId, label: first.label,
      bot: { ...first.botArtifact, source }, loadout: first.loadout });
    const input = { label: first.label, vehicleId: 'medium' as const, weaponId: 'medium-cannon' as const,
      tacticId: 'medium' as const, note: '只修改说明', baseRevision: 2 };
    const result = await service.saveRevision(player(), input);
    expect(result.currentRevision).toBe(2);
    expect((await buildRepository.load('commander-main', 2)).botArtifact.source).toBe(source);
    expect((await noteRepository.load('commander-main', 2)).note).toBe(input.note);
    expect(result.revisions[1]?.sourceKind).toBe('custom');
    await expect(service.saveRevision(player(), { ...input, baseRevision: 1 })).rejects.toThrow('其他窗口或 AI');
    expect((await buildRepository.list('commander-main')).length).toBe(2);
  });

  it('does not publish a new build when its annotation cannot be saved', async () => {
    const { service, buildRepository, noteRepository } = setup();
    await service.getSnapshot(player());
    vi.spyOn(noteRepository, 'save').mockRejectedValue(new Error('disk full'));
    await expect(service.saveRevision(player(), changedInput())).rejects.toThrow('disk full');
    expect((await buildRepository.list('commander-main')).length).toBe(1);
  });

  it('isolates a damaged annotation while keeping healthy notes visible', async () => {
    const { root, service } = setup();
    await service.getSnapshot(player());
    await service.saveRevision(player(), changedInput());
    writeFileSync(join(root, 'build-metadata', 'commander-main', '1.json'), '{');
    const result = await service.getSnapshot(player());
    expect(result.revisions[0]?.issue).toContain('说明');
    expect(result.revisions[1]?.note).toBe('提高侧翼机动性');
  });

  it('derives battle counts for each participating healthy revision from verified replays', async () => {
    const { service, buildRepository, replayRepository } = setup();
    await service.getSnapshot(player());
    await service.saveRevision(player(), changedInput());
    const first = await buildRepository.load('commander-main', 1);
    const second = await buildRepository.load('commander-main', 2);
    const output = await runPracticeMatchV2({
      current: second,
      opponent: first,
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      seed: 17,
      maxTicks: 4,
      createdAt: '2026-09-01T00:09:00.000Z',
      tickBudgetMs: 100,
      collectLogs: false,
    });
    await replayRepository.save(output.bundle);

    const snapshot = await service.getSnapshot(player());

    expect(snapshot.revisions.map((revision) => (
      revision.record.wins + revision.record.losses + revision.record.draws
    ))).toEqual([1, 1]);
  });

  it('reports a damaged tail without leaking it and exports a sanitized diagnostic', async () => {
    const { root, service } = setup();
    await service.getSnapshot(player());
    await service.saveRevision(player(), changedInput());
    const file = join(root, 'builds', 'commander-main', '2.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('light-cannon', 'heavy-cannon'), 'utf8');

    const snapshot = await service.getSnapshot(player());
    const diagnostic = await service.exportDiagnostic(player());
    const diagnosticText = readFileSync(join(root, 'diagnostics', diagnostic.fileName), 'utf8');

    expect(snapshot).toMatchObject({
      status: 'damaged',
      currentRevision: 1,
      revisions: [
        { revision: 1, state: 'healthy', selectable: true },
        { revision: 2, state: 'corrupt', selectable: false },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/module\.exports|[0-9a-f]{64}/);
    expect(diagnosticText).toContain('"state": "corrupt"');
    expect(diagnosticText).not.toMatch(/module\.exports|[0-9a-f]{64}/);
  });

  it('recovers the last healthy chain after quarantining a damaged tail', async () => {
    const { root, service, noteRepository } = setup();
    await service.getSnapshot(player());
    await service.saveRevision(player(), changedInput());
    const file = join(root, 'builds', 'commander-main', '2.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('light-cannon', 'heavy-cannon'), 'utf8');

    const recovered = await service.quarantineDamagedHistory(player());
    const replacement = await service.saveRevision(player(), { ...changedInput(), label: '侧翼突击修复版' });

    expect(recovered).toMatchObject({ status: 'ready', currentRevision: 1 });
    expect(replacement.revisions.map(({ revision, state }) => ({ revision, state }))).toEqual([
      { revision: 1, state: 'healthy' },
      { revision: 2, state: 'healthy' },
    ]);
    expect((await noteRepository.load('commander-main', 2)).note).toBe('提高侧翼机动性');
  });
});
