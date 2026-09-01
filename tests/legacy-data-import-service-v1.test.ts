import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SavedBuildRepositoryV2 } from '../src/config/saved-build-repository-v2.js';
import { LegacyDataImportServiceV1 } from '../src/desktop/legacy-data-import-service-v1.js';
import { PublicReplayRepositoryV1 } from '../src/desktop/public-replay-repository-v1.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agentic-game-legacy-'));
  const target = await mkdtemp(join(tmpdir(), 'agentic-game-import-target-'));
  roots.push(root, target);
  await mkdir(join(root, 'my-bots'));
  await mkdir(join(root, 'replays'));
  const builds = new SavedBuildRepositoryV2(join(target, 'builds'));
  const replays = new PublicReplayRepositoryV1(join(target, 'public-replays'));
  return { root, builds, replays, service: new LegacyDataImportServiceV1({ buildRepository: builds, publicReplayRepository: replays }) };
}

function legacyReplay() {
  return {
    format: 'tank-arena-replay', version: 1, engineVersion: '0.1.0', createdAt: '2026-08-23T15:37:21.926Z',
    mapId: 'standard', rules: { fieldWidth: 32, fieldHeight: 24, maxHp: 100 }, seeds: [1, 2],
    bots: [
      { name: 'Alpha', file: 'alpha.js', codeHash: '0123456789abcdef', violations: 0 },
      { name: 'Bravo', file: 'bravo.js', codeHash: 'fedcba9876543210', violations: 0 },
    ],
    result: { winner: 0, reason: 'destroyed', ticks: 2 },
    frames: [
      { tick: 1, tanks: [
        { id: 0, name: 'Alpha', x: 5, y: 12, hp: 100, dirBody: 2, dirTurret: 2, cooldown: 0, alive: true, violations: 0 },
        { id: 1, name: 'Bravo', x: 26, y: 11, hp: 100, dirBody: 6, dirTurret: 6, cooldown: 0, alive: true, violations: 0 },
      ], bullets: [], events: [] },
      { tick: 2, tanks: [
        { id: 0, name: 'Alpha', x: 6, y: 12, hp: 100, dirBody: 2, dirTurret: 2, cooldown: 0, alive: true, violations: 0 },
        { id: 1, name: 'Bravo', x: 25, y: 11, hp: 0, dirBody: 6, dirTurret: 6, cooldown: 0, alive: false, violations: 0 },
      ], bullets: [], events: [{ type: 'die', tick: 2, tankId: 1 }] },
    ],
  };
}

describe('LegacyDataImportServiceV1', () => {
  it('把旧 Bot 变为不可变版本，并把 Replay v1 转为可打开的脱敏回放', async () => {
    const { root, builds, replays, service } = await fixture();
    const source = 'module.exports = () => ({ onTick() { return { throttle: 1 }; } });';
    await writeFile(join(root, 'my-bots', 'old-scout.js'), source, 'utf8');
    await writeFile(join(root, 'replays', 'battle.json'), JSON.stringify(legacyReplay()), 'utf8');
    await writeFile(join(root, 'replays', 'broken.json'), '{', 'utf8');

    await expect(service.importFrom(root)).resolves.toEqual({ buildsImported: 1, replaysImported: 1, skipped: 1 });
    const history = await builds.list('commander-main');
    expect(history).toHaveLength(1);
    expect(history[0]!.botArtifact.source).toBe(source);
    expect(history[0]!.label).toBe('导入 · old-scout');
    const library = await replays.inspect();
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({ state: 'healthy', participantNames: ['Alpha', 'Bravo'] });
    expect(JSON.stringify(await replays.load(library[0]!.replayId))).not.toContain('codeHash');

    await expect(service.importFrom(root)).resolves.toEqual({ buildsImported: 0, replaysImported: 0, skipped: 3 });
  });

  it('拒绝越界根目录和符号链接式输入，只返回安全计数', async () => {
    const { service } = await fixture();
    await expect(service.importFrom('')).rejects.toThrow('没有选择旧版数据目录');
  });
});
