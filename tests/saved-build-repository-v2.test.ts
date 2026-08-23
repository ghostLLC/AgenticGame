import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SavedBuildRepositoryV2 } from '../src/config/saved-build-repository-v2.js';
import type { SavedBuildDraftV2 } from '../src/config/saved-build-v2.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(): { root: string; repository: SavedBuildRepositoryV2 } {
  const root = mkdtempSync(join(tmpdir(), 'agentic-game-builds-'));
  roots.push(root);
  return { root, repository: new SavedBuildRepositoryV2(root) };
}

function draft(sourceSuffix: string, version: string): SavedBuildDraftV2 {
  return {
    buildId: 'history-scout',
    label: 'History Scout',
    bot: {
      artifactId: 'history-scout-bot',
      version,
      language: 'javascript',
      entryPoint: 'history-scout.js',
      source: `module.exports = () => ({ onTick() { ${sourceSuffix}; return {}; } });`,
    },
    loadout: { vehicleId: 'scout', weaponId: 'light-cannon', equipmentIds: [] },
  };
}

describe('SavedBuildRepositoryV2', () => {
  it('persists an immutable revision chain and does not duplicate unchanged latest content', async () => {
    const { root, repository: repo } = repository();
    const first = await repo.save(draft('const phase = 1', '1.0.0'), '2026-08-24T00:00:00.000Z');
    const second = await repo.save(draft('const phase = 2', '1.0.1'), '2026-08-24T00:01:00.000Z');
    const unchanged = await repo.save(draft('const phase = 2', '1.0.1'), '2026-08-24T00:02:00.000Z');

    expect(first).toMatchObject({ created: true, record: { revision: 1, parentFingerprint: null } });
    expect(second).toMatchObject({ created: true, record: { revision: 2, parentFingerprint: first.record.fingerprint } });
    expect(unchanged).toEqual({ created: false, record: second.record });
    expect(readdirSync(join(root, 'history-scout')).sort()).toEqual(['1.json', '2.json']);
  });

  it('lists verified history in order and loads a specific or latest revision', async () => {
    const { repository: repo } = repository();
    const first = await repo.save(draft('const phase = 1', '1.0.0'), '2026-08-24T00:00:00.000Z');
    const second = await repo.save(draft('const phase = 2', '1.0.1'), '2026-08-24T00:01:00.000Z');

    expect(await repo.list('history-scout')).toEqual([first.record, second.record]);
    expect(await repo.load('history-scout', 1)).toEqual(first.record);
    expect(await repo.load('history-scout', 'latest')).toEqual(second.record);
    await expect(repo.load('history-scout', 3)).rejects.toThrow('Saved Build not found: history-scout@3');
  });

  it('fails closed when a persisted revision is corrupted or tampered', async () => {
    const { root, repository: repo } = repository();
    await repo.save(draft('const phase = 1', '1.0.0'), '2026-08-24T00:00:00.000Z');
    const file = join(root, 'history-scout', '1.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('light-cannon', 'heavy-cannon'), 'utf8');

    await expect(repo.list('history-scout')).rejects.toThrow('Invalid SavedBuildV2');
  });

  it('rejects path traversal before touching the filesystem', async () => {
    const { repository: repo } = repository();
    await expect(repo.list('../outside')).rejects.toThrow('Invalid buildId');
  });
});
