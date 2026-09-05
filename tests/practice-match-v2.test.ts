import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GAMEPLAY_CONTENT_V2, GAMEPLAY_MAP_FRONTIER_V2 } from '../src/core/v2/gameplay-content.js';
import { verifyMatchBundleV2 } from '../src/replay/v2.js';
import { SavedBuildRepositoryV2 } from '../src/config/saved-build-repository-v2.js';
import type { SavedBuildDraftV2 } from '../src/config/saved-build-v2.js';
import { runPracticeMatchV2 } from '../src/practice/run-practice-match-v2.js';
import { createPresetBuildV1 } from '../src/desktop/preset-builds-v1.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const oldSource = `
module.exports = () => ({
  name: 'Old Guard',
  onTick() { console.log('revision:old'); return { throttle: 0, bodyTurn: 0, turretTurn: 0, fire: false }; }
});`;

const newSource = `
module.exports = () => ({
  name: 'New Guard',
  onTick() { console.log('revision:new'); return { throttle: 1, bodyTurn: 0, turretTurn: 0, fire: false }; }
});`;

function draft(source: string, version: string): SavedBuildDraftV2 {
  return {
    buildId: 'practice-scout',
    label: 'Practice Scout',
    bot: {
      artifactId: 'practice-scout-bot',
      version,
      language: 'javascript',
      entryPoint: 'practice-scout.js',
      source,
    },
    loadout: { vehicleId: 'scout', weaponId: 'light-cannon', equipmentIds: [] },
  };
}

describe('runPracticeMatchV2', () => {
  it.each(['scout', 'medium', 'heavy'] as const)('runs the %s preset on the full map within the default execution budget', async (style) => {
    const current = createPresetBuildV1(style, '2026-09-05T00:00:00.000Z');
    const output = await runPracticeMatchV2({
      current, opponent:current, contentSnapshot:GAMEPLAY_CONTENT_V2,
      mapSnapshot:GAMEPLAY_MAP_FRONTIER_V2, seed:4, maxTicks:80,
    });
    expect(output.summary.violations).toEqual([0,0]);
    expect(['crash','load-failure','violations']).not.toContain(output.summary.reason);
    expect(output.summary.ticks).toBeGreaterThan(2);
  });

  it('runs a new saved revision against its old revision through the real sandbox and bundle path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentic-game-practice-'));
    roots.push(root);
    const repository = new SavedBuildRepositoryV2(root);
    const oldRevision = (await repository.save(draft(oldSource, '1.0.0'), '2026-08-24T00:00:00.000Z')).record;
    const newRevision = (await repository.save(draft(newSource, '1.0.1'), '2026-08-24T00:01:00.000Z')).record;
    const input = {
      current: newRevision,
      opponent: oldRevision,
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      seed: 77,
      maxTicks: 8,
      createdAt: '2026-08-24T00:02:00.000Z',
      tickBudgetMs: 100,
    };

    const first = await runPracticeMatchV2(input);
    const second = await runPracticeMatchV2(input);

    expect(second).toEqual(first);
    expect(first.participants).toEqual({
      current: { buildId: 'practice-scout', revision: 2, fingerprint: newRevision.fingerprint },
      opponent: { buildId: 'practice-scout', revision: 1, fingerprint: oldRevision.fingerprint },
    });
    expect(first.bundle.config.teams.map((team) => ({
      teamId: team.teamId,
      botHash: team.bot.codeHash,
      vehicleId: team.loadout.vehicleId,
      weaponIds: team.loadout.weaponIds,
    }))).toEqual([
      { teamId: 'current', botHash: newRevision.botArtifact.codeHash, vehicleId: 'scout', weaponIds: ['light-cannon'] },
      { teamId: 'historical', botHash: oldRevision.botArtifact.codeHash, vehicleId: 'scout', weaponIds: ['light-cannon'] },
    ]);
    expect(first.bundle.botArtifacts.map((artifact) => artifact.source)).toEqual([newSource, oldSource]);
    expect(first.bundle.actions).toHaveLength(16);
    expect(first.bundle.checkpoints).toHaveLength(9);
    expect(first.bundle.checkpoints[0]).toMatchObject({ tick: 0, state: { tick: 0 } });
    expect(first.bundle.logs.map((log) => log.message)).toEqual(expect.arrayContaining(['revision:new', 'revision:old']));
    expect(verifyMatchBundleV2(first.bundle)).toEqual({ ok: true, issues: [] });
  });

  it('rejects an unverified saved record instead of running it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentic-game-practice-'));
    roots.push(root);
    const repository = new SavedBuildRepositoryV2(root);
    const record = (await repository.save(draft(oldSource, '1.0.0'), '2026-08-24T00:00:00.000Z')).record;
    const tampered = structuredClone(record);
    tampered.loadout.vehicleId = 'heavy';

    await expect(runPracticeMatchV2({
      current: tampered,
      opponent: record,
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      seed: 77,
      maxTicks: 8,
      createdAt: '2026-08-24T00:02:00.000Z',
    })).rejects.toThrow('Invalid SavedBuildV2');
  });

  it('allows the same saved revision to run a deterministic mirror practice match', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentic-game-practice-'));
    roots.push(root);
    const repository = new SavedBuildRepositoryV2(root);
    const record = (await repository.save(draft(oldSource, '1.0.0'), '2026-08-24T00:00:00.000Z')).record;

    const result = await runPracticeMatchV2({
      current: record,
      opponent: record,
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      seed: 77,
      maxTicks: 4,
      createdAt: '2026-08-24T00:02:00.000Z',
      tickBudgetMs: 100,
    });

    expect(result.bundle.botArtifacts).toHaveLength(1);
    expect(result.bundle.config.teams[0]!.bot).toEqual(result.bundle.config.teams[1]!.bot);
    expect(verifyMatchBundleV2(result.bundle)).toEqual({ ok: true, issues: [] });
  });

  it('runs the selected capture mode and rejects unsupported modes before worker startup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentic-game-practice-'));
    roots.push(root);
    const repository = new SavedBuildRepositoryV2(root);
    const record = (await repository.save(draft(oldSource, '1.0.0'), '2026-08-24T00:00:00.000Z')).record;
    const baseInput = {
      current: record,
      opponent: record,
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      seed: 77,
      maxTicks: 4,
      createdAt: '2026-08-24T00:02:00.000Z',
      tickBudgetMs: 100,
    };

    const result = await runPracticeMatchV2({ ...baseInput, modeId: 'capture' });

    expect(result.bundle.config.modeId).toBe('capture');
    expect(verifyMatchBundleV2(result.bundle)).toEqual({ ok: true, issues: [] });
    await expect(runPracticeMatchV2({
      ...baseInput,
      modeId: 'ranked',
    } as unknown as Parameters<typeof runPracticeMatchV2>[0])).rejects.toThrow('Unsupported practice mode');
  });
});
