import { describe, expect, it } from 'vitest';
import { ReplayLibraryControllerV1 } from '../src/desktop/renderer/replay-library-controller-v1.js';
import { UnifiedReplayControllerV1 } from '../src/desktop/renderer/unified-replay-controller-v1.js';
import type { FriendRoomReplayV1 } from '../src/friend-room/replay-v1.js';

const card = {
  replayId: 'a'.repeat(64), source: 'practice' as const, createdAt: '2026-09-01T00:00:00.000Z',
  modeName: '歼灭决斗', participantNames: ['乐淳 r2', '乐淳 r1'], outcome: 'victory' as const,
  ticks: 80, note: '', integrity: 'verified' as const, playable: true,
};

const replay: FriendRoomReplayV1 = {
  version: 1,
  modeName: '歼灭决斗',
  map: { id: 'frontier', width: 2, height: 1, terrainCells: [], captureZones: [] },
  participants: [
    { teamId: 'current', displayName: '乐淳', vehicleName: '游骑坦克', weaponName: '轻型炮' },
    { teamId: 'historical', displayName: 'Ghost', vehicleName: '堡垒坦克', weaponName: '重型炮' },
  ],
  result: { winningTeamIds: ['current'], reason: 'elimination', ticks: 1 },
  moments: [{ tick: 0, kind: 'start', title: '开始', summary: '', teamIds: ['current', 'historical'] }],
  frames: [
    { tick: 0, tanks: [], projectiles: [], objective: null },
    { tick: 1, tanks: [], projectiles: [], objective: null },
  ],
};

describe('ReplayLibraryControllerV1', () => {
  it('preserves the last good library on refresh failure and guards concurrent mutations', async () => {
    let fail = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const api = {
      list: async () => {
        if (fail) throw new Error('offline');
        return { cards: [card], counts: { all: 1, practice: 1, friendPublic: 0, damaged: 0, trash: 0 } };
      },
      open: async () => ({ replayId: card.replayId, source: card.source, replay }),
      note: async () => { await pending; },
      export: async () => '练习赛回放.agentic-replay',
      moveToTrash: async () => ({ entryId: `practice-${card.replayId}` }),
      listTrash: async () => [],
      restore: async () => undefined,
      emptyTrash: async () => [],
      exportDiagnostic: async () => '回放诊断.json',
    };
    const controller = new ReplayLibraryControllerV1(api);
    await controller.initialize();
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', cards: [card] });
    fail = true;
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', cards: [card], message: '回放列表暂时无法刷新。' });
    fail = false;
    const mutation = controller.updateNote(card.replayId, card.source, '复盘');
    await expect(controller.moveToTrash(card.replayId, card.source)).rejects.toThrow('请等待当前操作完成');
    release();
    await mutation;
  });
});

describe('UnifiedReplayControllerV1', () => {
  it('opens, seeks, plays, pauses and closes one privacy-safe replay shape', () => {
    const controller = new UnifiedReplayControllerV1();
    controller.open(replay);
    controller.seek(1);
    controller.play();
    expect(controller.getSnapshot()).toMatchObject({ open: true, playing: true, frameIndex: 0 });
    expect(controller.advance()).toBe(false);
    controller.pause();
    controller.close();
    expect(controller.getSnapshot()).toEqual({ open: false, playing: false, frameIndex: 0 });
  });
});
