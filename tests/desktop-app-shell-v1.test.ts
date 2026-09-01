import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopApplicationServiceV1 } from '../src/desktop/application-service-v1.js';
import type { DesktopApiV1 } from '../src/desktop/desktop-api-v1.js';
import { PlayerProfileRepositoryV1 } from '../src/desktop/player-profile-repository-v1.js';
import { DesktopAppShellControllerV1 } from '../src/desktop/renderer/app-shell-controller-v1.js';
import { OnboardingControllerV1 } from '../src/desktop/renderer/onboarding-controller-v1.js';
import { desktopApiClientV1 } from '../src/desktop/renderer/desktop-api-client-v1.js';
import { createDesktopPreloadApiV1 } from '../src/desktop/desktop-preload-api-v1.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function realApi(): Promise<DesktopApiV1> {
  const root = await mkdtemp(join(tmpdir(), 'agentic-game-shell-'));
  roots.push(root);
  let minute = 0;
  const service = new DesktopApplicationServiceV1({
    profileRepository: new PlayerProfileRepositoryV1(root),
    now: () => `2026-09-01T00:${String(minute++).padStart(2, '0')}:00.000Z`,
    createPlayerId: () => '11111111-1111-4111-8111-111111111111',
  });
  return {
    app: { bootstrap: () => service.bootstrap() },
    profile: {
      create: (input) => service.createProfile(input),
      advanceTutorial: (stage) => service.advanceTutorial(stage),
    },
    navigation: { remember: (page) => service.rememberPage(page) },
    tutorial: { run: () => service.runTutorial() },
  };
}

describe('桌面 App Shell 与首次体验 v1', () => {
  it('缺少完整 preload 桥接时给出明确启动错误', () => {
    expect(() => desktopApiClientV1({})).toThrow('桌面游戏桥接未加载');
    expect(desktopApiClientV1({ agenticGameDesktop: createDesktopPreloadApiV1(async () => ({})) }))
      .toHaveProperty('tutorial.run');
  });

  it('从指挥官创建进入真实教学战斗、回放和完成状态', async () => {
    const api = await realApi();
    const onboarding = new OnboardingControllerV1(api);
    await onboarding.initialize(await api.app.bootstrap());
    expect(onboarding.getSnapshot()).toMatchObject({ phase: 'commander' });

    onboarding.enterCommanderName('乐淳');
    expect(onboarding.getSnapshot()).toMatchObject({ phase: 'doctrine', displayName: '乐淳' });
    await onboarding.chooseDoctrine('scout');
    expect(onboarding.getSnapshot()).toMatchObject({ phase: 'battle', profile: { doctrine: 'scout' } });

    const battle = onboarding.runBattle();
    expect(onboarding.getSnapshot()).toMatchObject({ phase: 'running' });
    await battle;
    expect(onboarding.getSnapshot()).toMatchObject({
      phase: 'replay',
      profile: { tutorialStage: 'replay' },
      result: { replay: { version: 1 } },
    });

    await onboarding.finishReplay();
    expect(onboarding.getSnapshot()).toMatchObject({ phase: 'complete', profile: { tutorialStage: 'complete' } });
  });

  it('在战斗或回放阶段重启时恢复原进度，不重复创建档案', async () => {
    const api = await realApi();
    await api.profile.create({ displayName: 'Ghost', doctrine: 'medium' });

    const battleResume = new OnboardingControllerV1(api);
    await battleResume.initialize(await api.app.bootstrap());
    expect(battleResume.getSnapshot()).toMatchObject({ phase: 'battle', profile: { displayName: 'Ghost' } });

    await api.profile.advanceTutorial('replay');
    const replayResume = new OnboardingControllerV1(api);
    const restoring = replayResume.initialize(await api.app.bootstrap());
    expect(replayResume.getSnapshot()).toMatchObject({ phase: 'running' });
    await restoring;
    expect(replayResume.getSnapshot()).toMatchObject({ phase: 'replay', result: { replay: { version: 1 } } });
  });

  it('完成教程后打开已启用的最近页面，并把未开放页面回退到指挥中心', async () => {
    const api = await realApi();
    await api.profile.create({ displayName: '乐淳', doctrine: 'heavy' });
    await api.profile.advanceTutorial('replay');
    await api.profile.advanceTutorial('complete');
    await api.navigation.remember('friend-room');

    const shell = new DesktopAppShellControllerV1(api, ['command-center', 'garage', 'practice', 'friend-room', 'replays']);
    await shell.bootstrap();
    expect(shell.getSnapshot()).toMatchObject({ status: 'ready', page: 'friend-room' });
    await shell.navigate('command-center');
    expect(shell.getSnapshot()).toMatchObject({ status: 'ready', page: 'command-center' });
    expect((await api.app.bootstrap()).profile?.recentPage).toBe('command-center');

    await shell.navigate('garage');
    expect(shell.getSnapshot()).toMatchObject({ status: 'ready', page: 'garage' });
    await shell.navigate('practice');
    expect(shell.getSnapshot()).toMatchObject({ status: 'ready', page: 'practice' });
    expect((await api.app.bootstrap()).profile?.recentPage).toBe('practice');
    await shell.navigate('replays');
    expect(shell.getSnapshot()).toMatchObject({ status: 'ready', page: 'replays' });

    await api.navigation.remember('practice');
    const restarted = new DesktopAppShellControllerV1(api, ['command-center', 'garage', 'practice', 'friend-room', 'replays']);
    await restarted.bootstrap();
    expect(restarted.getSnapshot()).toMatchObject({ status: 'ready', page: 'practice' });
  });
});
