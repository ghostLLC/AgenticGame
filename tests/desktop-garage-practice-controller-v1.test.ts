import { describe, expect, it, vi } from 'vitest';
import type { DesktopApiV1 } from '../src/desktop/desktop-api-v1.js';
import type { GarageSnapshotV1 } from '../src/desktop/garage-service-v1.js';
import { GarageControllerV1 } from '../src/desktop/renderer/garage-controller-v1.js';
import { PracticeLabControllerV1 } from '../src/desktop/renderer/practice-lab-controller-v1.js';

function garage(revisions = [1, 2]): GarageSnapshotV1 {
  return {
    status: 'ready',
    buildId: 'commander-main',
    currentRevision: revisions.at(-1),
    vehicles: [],
    weapons: [],
    tactics: [],
    revisions: revisions.map((revision) => ({
      revision,
      state: 'healthy',
      label: `战术 ${revision}`,
      createdAt: `2026-09-01T00:0${revision}:00.000Z`,
      vehicleName: '中型坦克',
      weaponName: '中型炮',
      tacticName: '中线突击',
      note: '',
      changes: revision === 1 ? ['创建首个版本'] : ['战术调整'],
      record: { wins: 0, losses: 0, draws: 0 },
      selectable: true,
    })),
  };
}

function api(overrides: Partial<DesktopApiV1['garage']> = {}, run = vi.fn()): DesktopApiV1 {
  return {
    garage: {
      get: vi.fn(async () => garage()),
      save: vi.fn(async () => garage([1, 2, 3])),
      quarantine: vi.fn(async () => garage([1])),
      exportDiagnostic: vi.fn(async () => ({ fileName: 'garage-diagnostic.json' })),
      ...overrides,
    },
    practice: { run },
  } as unknown as DesktopApiV1;
}

describe('GarageControllerV1', () => {
  it('loads, saves and quarantines while exposing cloned snapshots', async () => {
    const controller = new GarageControllerV1(api());
    const loading = controller.load();
    expect(controller.getSnapshot()).toMatchObject({ status: 'loading' });
    await loading;
    const first = controller.getSnapshot();
    expect(first).toMatchObject({ status: 'ready', garage: { currentRevision: 2 } });
    first.garage!.revisions[0]!.label = '被外部修改';
    expect(controller.getSnapshot().garage!.revisions[0]!.label).toBe('战术 1');

    await controller.save({
      label: '伏击配置', vehicleId: 'heavy', weaponId: 'heavy-cannon', tacticId: 'heavy', note: '',
    });
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', garage: { currentRevision: 3 } });
    await controller.quarantine();
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', garage: { currentRevision: 1 } });
  });

  it('preserves the last healthy garage when a later operation fails', async () => {
    const controller = new GarageControllerV1(api({
      save: vi.fn(async () => { throw new Error('磁盘暂时不可用'); }),
      quarantine: vi.fn(async () => { throw 'unknown'; }),
    }));
    await controller.load();

    await controller.save({
      label: '伏击配置', vehicleId: 'heavy', weaponId: 'heavy-cannon', tacticId: 'heavy', note: '',
    });
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready', garage: { currentRevision: 2 }, error: '磁盘暂时不可用',
    });
    await controller.quarantine();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready', garage: { currentRevision: 2 }, error: '操作没有完成，请稍后重试。',
    });
  });
});

describe('PracticeLabControllerV1', () => {
  it('requires a selectable revision and transitions idle to running to complete', async () => {
    let finish!: (value: Awaited<ReturnType<DesktopApiV1['practice']['run']>>) => void;
    const run = vi.fn(() => new Promise<Awaited<ReturnType<DesktopApiV1['practice']['run']>>>((resolve) => {
      finish = resolve;
    }));
    const controller = new PracticeLabControllerV1(api({}, run));
    controller.setGarage(garage([]));
    await expect(controller.run({ currentRevision: 1, opponentRevision: 1, modeId: 'duel' }))
      .rejects.toThrow('需要一个可用版本');
    controller.setGarage(garage());

    const pending = controller.run({ currentRevision: 2, opponentRevision: 1, modeId: 'capture', seed: 4 });
    expect(controller.getSnapshot()).toMatchObject({ status: 'running', availableRevisions: [1, 2] });
    await expect(controller.run({ currentRevision: 2, opponentRevision: 1, modeId: 'duel' }))
      .rejects.toThrow('比赛正在进行中');
    finish({
      replayHash: 'a'.repeat(64),
      currentRevision: 2,
      opponentRevision: 1,
      outcome: 'victory',
      modeName: '据点争夺',
      ticks: 45,
      moments: [{ tick: 45, title: '比赛结束', summary: '玩家获胜' }],
    });
    await pending;
    expect(controller.getSnapshot()).toMatchObject({ status: 'complete', result: { outcome: 'victory' } });
  });

  it('allows a first-version mirror practice', async () => {
    const run = vi.fn(async () => ({ replayHash: 'a'.repeat(64), currentRevision: 1, opponentRevision: 1,
      outcome: 'draw' as const, modeName: '歼灭决斗', ticks: 8, moments: [] }));
    const controller = new PracticeLabControllerV1(api({}, run));
    controller.setGarage(garage([1]));
    await controller.run({ currentRevision: 1, opponentRevision: 1, modeId: 'duel' });
    expect(run).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe('complete');
  });

  it('keeps the completed result when a later run fails', async () => {
    const successful = {
      replayHash: 'b'.repeat(64), currentRevision: 2, opponentRevision: 1,
      outcome: 'draw' as const, modeName: '歼灭决斗', ticks: 120, moments: [],
    };
    const run = vi.fn()
      .mockResolvedValueOnce(successful)
      .mockRejectedValueOnce(new Error('比赛引擎繁忙'));
    const controller = new PracticeLabControllerV1(api({}, run));
    controller.setGarage(garage());
    await controller.run({ currentRevision: 2, opponentRevision: 1, modeId: 'duel' });
    const external = controller.getSnapshot();
    external.result!.modeName = '被外部修改';
    expect(controller.getSnapshot().result!.modeName).toBe('歼灭决斗');

    await controller.run({ currentRevision: 2, opponentRevision: 1, modeId: 'capture' });
    expect(controller.getSnapshot()).toMatchObject({
      status: 'complete', result: { outcome: 'draw' }, error: '比赛引擎繁忙',
    });
  });
});
