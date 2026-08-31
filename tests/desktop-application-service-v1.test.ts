import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopApplicationServiceV1 } from '../src/desktop/application-service-v1.js';
import { PlayerProfileRepositoryV1 } from '../src/desktop/player-profile-repository-v1.js';
import { SavedBuildRepositoryV2 } from '../src/config/saved-build-repository-v2.js';
import { ReplayRepositoryV2 } from '../src/replay/repository-v2.js';
import { BuildRevisionNoteRepositoryV1 } from '../src/desktop/build-revision-note-repository-v1.js';
import { GarageServiceV1 } from '../src/desktop/garage-service-v1.js';
import { PracticeMatchServiceV1 } from '../src/desktop/practice-match-service-v1.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function service(): Promise<DesktopApplicationServiceV1> {
  const root = await mkdtemp(join(tmpdir(), 'agentic-game-application-'));
  roots.push(root);
  let minute = 0;
  const now = () => `2026-08-31T10:${String(minute++).padStart(2, '0')}:00.000Z`;
  const quarantineRoot = join(root, 'quarantine');
  const buildRepository = new SavedBuildRepositoryV2(join(root, 'builds'), { quarantineRoot, now });
  const replayRepository = new ReplayRepositoryV2(join(root, 'replays'));
  return new DesktopApplicationServiceV1({
    profileRepository: new PlayerProfileRepositoryV1(root),
    garageService: new GarageServiceV1({
      buildRepository,
      noteRepository: new BuildRevisionNoteRepositoryV1(join(root, 'build-metadata'), { quarantineRoot, now }),
      replayRepository,
      diagnosticsRoot: join(root, 'diagnostics'),
      now,
    }),
    practiceService: new PracticeMatchServiceV1({ buildRepository, replayRepository, now }),
    now,
    createPlayerId: () => '11111111-1111-4111-8111-111111111111',
  });
}

describe('DesktopApplicationServiceV1', () => {
  it('从首次启动创建严格档案并完成可恢复教程', async () => {
    const app = await service();
    await expect(app.bootstrap()).resolves.toEqual({ needsOnboarding: true });

    const created = await app.createProfile({ displayName: '乐淳', doctrine: 'scout' });
    expect(created).toMatchObject({ displayName: '乐淳', tutorialStage: 'battle' });
    await expect(app.createProfile({ displayName: '重复', doctrine: 'heavy' }))
      .rejects.toThrow('玩家档案已经存在');

    const tutorial = await app.runTutorial();
    expect(tutorial.replay.frames.length).toBeGreaterThan(1);
    expect((await app.bootstrap()).profile).toMatchObject({ tutorialStage: 'battle' });

    await expect(app.advanceTutorial('replay')).resolves.toMatchObject({ tutorialStage: 'replay' });
    await expect(app.advanceTutorial('complete')).resolves.toMatchObject({ tutorialStage: 'complete' });
    await expect(app.advanceTutorial('battle')).rejects.toThrow('教程进度无效');

    await expect(app.rememberPage('friend-room')).resolves.toMatchObject({
      recentPage: 'friend-room',
      tutorialStage: 'complete',
    });
    await expect(app.bootstrap()).resolves.toMatchObject({
      needsOnboarding: false,
      profile: { recentPage: 'friend-room', tutorialStage: 'complete' },
    });
  });

  it('没有档案时拒绝运行教学局、推进教程和记录页面', async () => {
    const app = await service();
    await expect(app.runTutorial()).rejects.toThrow('请先建立指挥官档案');
    await expect(app.advanceTutorial('replay')).rejects.toThrow('请先建立指挥官档案');
    await expect(app.rememberPage('garage')).rejects.toThrow('请先建立指挥官档案');
  });

  it('只允许完成新手教程的玩家使用车库和练习赛', async () => {
    const app = await service();
    await expect(app.getGarage()).rejects.toThrow('请先建立指挥官档案');
    await expect(app.runPractice({ currentRevision: 1, opponentRevision: 1, modeId: 'duel' }))
      .rejects.toThrow('请先建立指挥官档案');

    await app.createProfile({ displayName: '乐淳', doctrine: 'medium' });
    await expect(app.getGarage()).rejects.toThrow('请先完成新手教程');
    await app.advanceTutorial('replay');
    await app.advanceTutorial('complete');

    const garage = await app.getGarage();
    const updated = await app.saveGarageRevision({
      label: '侧翼突击', vehicleId: 'scout', weaponId: 'light-cannon', tacticId: 'scout', note: '尝试侧翼',
    });
    const match = await app.runPractice({ currentRevision: 2, opponentRevision: 1, modeId: 'duel', seed: 7 });

    expect(garage).toMatchObject({ status: 'ready', currentRevision: 1 });
    expect(updated).toMatchObject({ status: 'ready', currentRevision: 2 });
    expect(match).toMatchObject({ currentRevision: 2, opponentRevision: 1, modeName: '歼灭决斗' });
  });
});
