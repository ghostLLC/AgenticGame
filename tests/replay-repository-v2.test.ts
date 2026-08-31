import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GAMEPLAY_CONTENT_V2, GAMEPLAY_MAP_FRONTIER_V2 } from '../src/core/v2/gameplay-content.js';
import type { MatchConfigV2 } from '../src/core/v2/match-config.js';
import { ReplayRepositoryV2 } from '../src/replay/repository-v2.js';
import { runMatchV2 } from '../src/runner/match-v2.js';
import { fullCodeHash } from '../src/runner/v2-adapter.js';

const roots: string[] = [];
const idleBot = `
module.exports = function createTank() {
  return { name: 'Idle', onTick() { return {}; } };
};`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(): { root: string; repository: ReplayRepositoryV2 } {
  const root = mkdtempSync(join(tmpdir(), 'agentic-game-replays-'));
  roots.push(root);
  return { root, repository: new ReplayRepositoryV2(root) };
}

function matchConfig(): MatchConfigV2 {
  const codeHash = fullCodeHash(idleBot);
  return {
    schemaVersion: 2,
    matchId: 'persisted-replay-v2',
    ruleset: { id: 'gameplay-v2', version: '2.0.0' },
    modeId: 'duel',
    mapId: GAMEPLAY_MAP_FRONTIER_V2.id,
    seed: 17,
    maxTicks: 2,
    teams: [
      {
        teamId: 'current', displayName: 'Current Build',
        bot: { artifactId: 'idle-bot', version: '1.0.0', codeHash },
        loadout: { vehicleId: 'scout', weaponIds: ['light-cannon'], equipmentIds: [] },
      },
      {
        teamId: 'historical', displayName: 'Historical Build',
        bot: { artifactId: 'idle-bot', version: '1.0.0', codeHash },
        loadout: { vehicleId: 'scout', weaponIds: ['light-cannon'], equipmentIds: [] },
      },
    ],
  };
}

describe('ReplayRepositoryV2', () => {
  it('persists a real match from the runner, lists metadata, and deduplicates by bundle hash', async () => {
    const { root, repository: repo } = repository();
    const output = await runMatchV2({
      matchConfig: matchConfig(),
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      bots: [{ code: idleBot }, { code: idleBot }],
      createdAt: '2026-08-24T04:00:00.000Z',
      tickBudgetMs: 100,
      onBundle: (bundle) => repo.save(bundle),
    });

    const duplicate = await repo.save(output.bundle);
    expect(duplicate).toEqual({ created: false, bundle: output.bundle });
    expect(await repo.load(output.bundle.integrity.bundleHash)).toEqual(output.bundle);
    expect(await repo.list()).toEqual([
      expect.objectContaining({
        bundleHash: output.bundle.integrity.bundleHash,
        matchId: 'persisted-replay-v2',
        modeId: 'duel',
        mapId: 'frontier-v2',
        teamNames: ['Current Build', 'Historical Build'],
        ticks: 2,
      }),
    ]);
    expect(readdirSync(root).filter((entry) => entry.endsWith('.json'))).toEqual([
      `${output.bundle.integrity.bundleHash}.json`,
    ]);
  });

  it('fails closed when a persisted replay is tampered', async () => {
    const { root, repository: repo } = repository();
    const output = await runMatchV2({
      matchConfig: matchConfig(),
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      bots: [{ code: idleBot }, { code: idleBot }],
      createdAt: '2026-08-24T04:00:00.000Z',
      tickBudgetMs: 100,
    });
    await repo.save(output.bundle);
    const file = join(root, `${output.bundle.integrity.bundleHash}.json`);
    writeFileSync(file, readFileSync(file, 'utf8').replace('Current Build', 'Tampered Build'), 'utf8');

    await expect(repo.load(output.bundle.integrity.bundleHash)).rejects.toThrow('Invalid MatchBundleV2');
    await expect(repo.list()).rejects.toThrow('Invalid MatchBundleV2');
  });

  it('rejects invalid bundle hashes before touching the filesystem', async () => {
    const { repository: repo } = repository();
    await expect(repo.load('../outside')).rejects.toThrow('Invalid bundle hash');
  });

  it('inspects healthy and corrupt replay files independently without exposing bundles', async () => {
    const { root, repository: repo } = repository();
    const first = await runMatchV2({
      matchConfig: matchConfig(), contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2, bots: [{ code: idleBot }, { code: idleBot }],
      createdAt: '2026-08-24T04:00:00.000Z', tickBudgetMs: 100,
    });
    const second = await runMatchV2({
      matchConfig: { ...matchConfig(), matchId: 'second-replay-v2' }, contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2, bots: [{ code: idleBot }, { code: idleBot }],
      createdAt: '2026-08-24T04:01:00.000Z', tickBudgetMs: 100,
    });
    await repo.save(first.bundle);
    await repo.save(second.bundle);
    const corruptPath = join(root, `${second.bundle.integrity.bundleHash}.json`);
    writeFileSync(corruptPath, readFileSync(corruptPath, 'utf8').replace('second-replay-v2', 'tampered-replay'), 'utf8');

    const inspection = await repo.inspect();

    expect(inspection).toEqual([
      expect.objectContaining({ bundleHash: second.bundle.integrity.bundleHash, state: 'corrupt' }),
      expect.objectContaining({ bundleHash: first.bundle.integrity.bundleHash, state: 'healthy', entry: expect.objectContaining({ matchId: 'persisted-replay-v2' }) }),
    ]);
    expect(JSON.stringify(inspection)).not.toContain('module.exports');
    expect(JSON.stringify(inspection)).not.toContain('botArtifacts');
  });
});
