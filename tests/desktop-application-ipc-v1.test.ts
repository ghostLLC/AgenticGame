import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopApplicationServiceV1 } from '../src/desktop/application-service-v1.js';
import {
  registerDesktopApplicationIpcV1,
  type DesktopIpcHandlerV1,
} from '../src/desktop/application-ipc-v1.js';
import { PlayerProfileRepositoryV1 } from '../src/desktop/player-profile-repository-v1.js';
import { createDesktopPreloadApiV1 } from '../src/desktop/desktop-preload-api-v1.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('桌面应用 IPC v1', () => {
  it('只注册玩家应用白名单，并在服务前拒绝非法输入', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentic-game-ipc-'));
    roots.push(root);
    const service = new DesktopApplicationServiceV1({
      profileRepository: new PlayerProfileRepositoryV1(root),
      now: () => '2026-08-31T10:00:00.000Z',
      createPlayerId: () => '11111111-1111-4111-8111-111111111111',
    });
    const handlers = new Map<string, DesktopIpcHandlerV1>();

    registerDesktopApplicationIpcV1({
      handle: (channel, handler) => handlers.set(channel, handler),
    }, service);

    expect([...handlers.keys()]).toEqual([
      'app:bootstrap',
      'profile:create',
      'profile:advance-tutorial',
      'navigation:remember',
      'tutorial:run',
    ]);
    await expect(handlers.get('profile:create')?.({}, { displayName: 3, doctrine: 'scout' }))
      .rejects.toThrow('指挥官信息无效');
    await expect(handlers.get('navigation:remember')?.({}, 'developer-console'))
      .rejects.toThrow('页面无效');
    await expect(handlers.get('app:bootstrap')?.({})).resolves.toEqual({ needsOnboarding: true });
  });

  it('把页面操作映射到固定 IPC，而不暴露通用调用器', async () => {
    const calls: Array<[string, unknown?]> = [];
    const api = createDesktopPreloadApiV1(async (channel, input) => {
      calls.push([channel, input]);
      return {};
    });

    await api.app.bootstrap();
    await api.profile.create({ displayName: '乐淳', doctrine: 'medium' });
    await api.profile.advanceTutorial('replay');
    await api.navigation.remember('friend-room');
    await api.tutorial.run();

    expect(calls).toEqual([
      ['app:bootstrap', undefined],
      ['profile:create', { displayName: '乐淳', doctrine: 'medium' }],
      ['profile:advance-tutorial', 'replay'],
      ['navigation:remember', 'friend-room'],
      ['tutorial:run', undefined],
    ]);
    expect(api).not.toHaveProperty('invoke');
  });
});
