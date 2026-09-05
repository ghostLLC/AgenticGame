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
import { SavedBuildRepositoryV2 } from '../src/config/saved-build-repository-v2.js';
import { ReplayRepositoryV2 } from '../src/replay/repository-v2.js';
import { BuildRevisionNoteRepositoryV1 } from '../src/desktop/build-revision-note-repository-v1.js';
import { GarageServiceV1 } from '../src/desktop/garage-service-v1.js';
import { PracticeMatchServiceV1 } from '../src/desktop/practice-match-service-v1.js';
import { PublicReplayRepositoryV1 } from '../src/desktop/public-replay-repository-v1.js';
import { ReplayMetadataRepositoryV1 } from '../src/desktop/replay-metadata-repository-v1.js';
import { ReplayTrashRepositoryV1 } from '../src/desktop/replay-trash-repository-v1.js';
import { ReplayLibraryServiceV1 } from '../src/desktop/replay-library-service-v1.js';
import { defaultAppSettingsV1 } from '../src/desktop/app-settings-v1.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('桌面应用 IPC v1', () => {
  it('只注册玩家应用白名单，并在服务前拒绝非法输入', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentic-game-ipc-'));
    roots.push(root);
    const now = () => '2026-08-31T10:00:00.000Z';
    const quarantineRoot = join(root, 'quarantine');
    const buildRepository = new SavedBuildRepositoryV2(join(root, 'builds'), { quarantineRoot, now });
    const replayRepository = new ReplayRepositoryV2(join(root, 'replays'));
    const service = new DesktopApplicationServiceV1({
      profileRepository: new PlayerProfileRepositoryV1(root),
      garageService: new GarageServiceV1({
        buildRepository,
        noteRepository: new BuildRevisionNoteRepositoryV1(join(root, 'build-metadata'), { quarantineRoot, now }),
        replayRepository,
        diagnosticsRoot: join(root, 'diagnostics'),
        now,
      }),
      practiceService: new PracticeMatchServiceV1({ buildRepository, replayRepository, now }),
      replayService: new ReplayLibraryServiceV1({
        replayRepository,
        publicRepository: new PublicReplayRepositoryV1(join(root, 'public-replays')),
        metadataRepository: new ReplayMetadataRepositoryV1(join(root, 'replay-metadata')),
        trashRepository: new ReplayTrashRepositoryV1(join(root, 'replay-trash'), { now }),
        exportsRoot: join(root, 'exports'), now,
      }),
      now,
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
      'garage:get',
      'garage:save',
      'garage:quarantine',
      'garage:export-diagnostic',
      'practice:run',
      'practice:cancel',
      'replays:list',
      'replays:open',
      'replays:note',
      'replays:export',
      'replays:backup',
      'replays:import',
      'replays:reveal-export',
      'replays:move-to-trash',
      'replays:list-trash',
      'replays:restore',
      'replays:empty-trash',
      'replays:export-diagnostic',
      'agent-center:get',
      'agent-center:progress',
      'agent-center:run',
      'agent-center:cancel',
      'agent-center:save',
      'agent-connector:inspect',
      'agent-connector:connect',
      'settings:get',
      'settings:save',
      'settings:diagnostic-preview',
      'settings:run-diagnostics',
      'settings:export-diagnostics',
      'settings:import-legacy',
      'settings:open-releases',
    ]);
    await expect(handlers.get('profile:create')?.({}, { displayName: 3, doctrine: 'scout' }))
      .rejects.toThrow('指挥官信息无效');
    await expect(handlers.get('navigation:remember')?.({}, 'developer-console'))
      .rejects.toThrow('页面无效');
    await expect(handlers.get('garage:save')?.({}, {
      label: '', vehicleId: 'scout', weaponId: 'light-cannon', tacticId: 'scout', note: '',
    })).rejects.toThrow('车库配置无效');
    await expect(handlers.get('garage:save')?.({}, {
      label: '错误搭配', vehicleId: 'heavy', weaponId: 'light-cannon', tacticId: 'heavy', note: '',
    })).rejects.toThrow('车库配置无效');
    await expect(handlers.get('practice:run')?.({}, {
      currentRevision: 0, opponentRevision: 1, modeId: 'duel', seed: 1,
    })).rejects.toThrow('练习赛配置无效');
    await expect(handlers.get('replays:open')?.({}, { replayId: '../escape', source: 'practice' }))
      .rejects.toThrow('回放操作无效');
    await expect(handlers.get('replays:note')?.({}, { replayId: 'a'.repeat(64), source: 'practice', note: 'x', path: 'C:\\' }))
      .rejects.toThrow('回放操作无效');
    await expect(handlers.get('replays:empty-trash')?.({}, false)).rejects.toThrow('需要明确确认');
    await expect(handlers.get('agent-center:run')?.({}, {
      revision: 1,
      provider: { kind: 'openai-compatible', baseUrl: 'http://localhost.evil.example/v1', model: 'model', apiKey: 'key' },
      goal: '调整战术', depth: 'quick',
    })).rejects.toThrow('AI 战术调整参数无效');
    await expect(handlers.get('agent-center:save')?.({}, {
      candidateId: 'candidate-1', label: '候选', note: '', confirmed: false,
    })).rejects.toThrow('需要明确确认');
    await expect(handlers.get('agent-connector:connect')?.({}, 'claude-code'))
      .rejects.toThrow('AI 队友无效');
    await expect(handlers.get('settings:save')?.({}, { ...defaultAppSettingsV1(), apiKey: 'forbidden' }))
      .rejects.toThrow('设置无效');
    await expect(handlers.get('practice:run')?.({}, {
      currentRevision: 1, opponentRevision: 1, modeId: 'ranked', seed: 1,
    })).rejects.toThrow('练习赛配置无效');
    await expect(handlers.get('practice:run')?.({}, {
      currentRevision: 1, opponentRevision: 1, modeId: 'duel', seed: -1,
    })).rejects.toThrow('练习赛配置无效');
    await expect(handlers.get('app:bootstrap')?.({})).resolves.toEqual({ needsOnboarding: true });
    await service.createProfile({ displayName: '测试玩家', doctrine: 'medium' });
    await service.advanceTutorial('replay'); await service.advanceTutorial('complete');
    const original = await service.getGarage();
    await expect(handlers.get('garage:save')?.({}, {
      label: original.revisions[0]!.label, vehicleId: 'medium', weaponId: 'medium-cannon', tacticId: 'medium',
      note: '通过 IPC 保存说明', baseRevision: 1, replaceTactic: false,
    })).resolves.toMatchObject({ currentRevision: 1, revisions: [{ note: '通过 IPC 保存说明' }] });
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
    await api.garage.get();
    await api.garage.save({
      label: '侧翼突击', vehicleId: 'scout', weaponId: 'light-cannon', tacticId: 'scout', note: '尝试侧翼',
    });
    await api.garage.quarantine();
    await api.garage.exportDiagnostic();
    await api.practice.run({ currentRevision: 2, opponentRevision: 1, modeId: 'capture', seed: 9 });
    await api.replays.list({ source: 'practice' });
    await api.replays.open({ replayId: 'a'.repeat(64), source: 'practice' });
    await api.replays.note({ replayId: 'a'.repeat(64), source: 'practice', note: '侧翼时机' });
    await api.replays.export({ replayId: 'a'.repeat(64), source: 'practice' });
    await api.replays.moveToTrash({ replayId: 'a'.repeat(64), source: 'practice' });
    await api.replays.listTrash();
    await api.replays.restore('practice-' + 'a'.repeat(64));
    await api.replays.emptyTrash(true);
    await api.replays.exportDiagnostic();
    await api.agentCenter.get();
    await api.agentCenter.run({
      revision: 2,
      provider: { kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-test', apiKey: 'session-key' },
      goal: '加强抢点', depth: 'standard',
    });
    await api.agentCenter.cancel();
    await api.agentCenter.save({ candidateId: 'candidate-1', label: 'AI 抢点版', note: '提高抢点', confirmed: true });
    await api.agentConnector.inspect();
    await api.agentConnector.connect('codex');
    await api.settings.get();
    await api.settings.save({ ...defaultAppSettingsV1(), masterVolume: 60 });
    await api.settings.diagnosticPreview();
    await api.settings.runDiagnostics();
    await api.settings.exportDiagnostics();
    await api.settings.importLegacy();
    await api.settings.openReleases();

    expect(calls).toEqual([
      ['app:bootstrap', undefined],
      ['profile:create', { displayName: '乐淳', doctrine: 'medium' }],
      ['profile:advance-tutorial', 'replay'],
      ['navigation:remember', 'friend-room'],
      ['tutorial:run', undefined],
      ['garage:get', undefined],
      ['garage:save', {
        label: '侧翼突击', vehicleId: 'scout', weaponId: 'light-cannon', tacticId: 'scout', note: '尝试侧翼',
      }],
      ['garage:quarantine', undefined],
      ['garage:export-diagnostic', undefined],
      ['practice:run', { currentRevision: 2, opponentRevision: 1, modeId: 'capture', seed: 9 }],
      ['replays:list', { source: 'practice' }],
      ['replays:open', { replayId: 'a'.repeat(64), source: 'practice' }],
      ['replays:note', { replayId: 'a'.repeat(64), source: 'practice', note: '侧翼时机' }],
      ['replays:export', { replayId: 'a'.repeat(64), source: 'practice' }],
      ['replays:move-to-trash', { replayId: 'a'.repeat(64), source: 'practice' }],
      ['replays:list-trash', undefined],
      ['replays:restore', 'practice-' + 'a'.repeat(64)],
      ['replays:empty-trash', true],
      ['replays:export-diagnostic', undefined],
      ['agent-center:get', undefined],
      ['agent-center:run', {
        revision: 2,
        provider: { kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-test', apiKey: 'session-key' },
        goal: '加强抢点', depth: 'standard',
      }],
      ['agent-center:cancel', undefined],
      ['agent-center:save', { candidateId: 'candidate-1', label: 'AI 抢点版', note: '提高抢点', confirmed: true }],
      ['agent-connector:inspect', undefined],
      ['agent-connector:connect', 'codex'],
      ['settings:get', undefined],
      ['settings:save', { ...defaultAppSettingsV1(), masterVolume: 60 }],
      ['settings:diagnostic-preview', undefined],
      ['settings:run-diagnostics', undefined],
      ['settings:export-diagnostics', undefined],
      ['settings:import-legacy', undefined],
      ['settings:open-releases', undefined],
    ]);
    expect(api).not.toHaveProperty('invoke');
  });
});
