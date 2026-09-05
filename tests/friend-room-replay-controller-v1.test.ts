import { describe, expect, it } from 'vitest';
import type { FriendRoomReplayV1 } from '../src/friend-room/replay-v1.js';
import { FriendRoomReplayControllerV1, replayMomentTickV1 } from '../src/desktop/friend-room-replay-controller-v1.js';

const replay: FriendRoomReplayV1 = {
  version: 1,
  modeName: '歼灭决斗',
  map: { id: 'frontier-v2', width: 2, height: 1, terrainCells: [
    { x: 0, y: 0, terrainId: 'open-ground' },
    { x: 1, y: 0, terrainId: 'forest' },
  ], captureZones: [] },
  participants: [
    { teamId: 'current', displayName: '乐淳', vehicleName: '中型坦克', weaponName: '中型炮' },
    { teamId: 'historical', displayName: 'Ghost', vehicleName: '重型坦克', weaponName: '重型炮' },
  ],
  result: { winningTeamIds: ['current'], reason: 'elimination', ticks: 2 },
  moments: [
    { tick: 0, kind: 'start', title: '比赛开始', summary: '乐淳 vs Ghost', teamIds: ['current', 'historical'] },
    { tick: 2, kind: 'result', title: '比赛结束', summary: '乐淳获胜', teamIds: ['current'] },
  ],
  frames: [0, 1, 2].map((tick) => ({
    tick,
    tanks: [
      { teamId: 'current', displayName: '乐淳', vehicleName: '中型坦克', x: tick, y: 0, hp: 100, maxHp: 110, bodyDirection: 2, turretDirection: 2, ammunition: 10, alive: true },
      { teamId: 'historical', displayName: 'Ghost', vehicleName: '重型坦克', x: 1, y: 0, hp: tick === 2 ? 0 : 150, maxHp: 150, bodyDirection: 6, turretDirection: 6, ammunition: 8, alive: tick !== 2 },
    ],
    projectiles: [],
    objective: null,
  })),
};

describe('好友赛回放控制器 v1', () => {
  it('seeks a destruction to the checkpoint that shows its outcome, while preserving start and final frames', () => {
    const moment = { tick: 1, kind: 'destruction' as const, title: '被摧毁', summary: '', teamIds: ['historical'] };
    const controller = new FriendRoomReplayControllerV1();
    controller.open(replay);
    controller.seek(replay.frames.findIndex((frame) => frame.tick === replayMomentTickV1(replay, moment)));
    expect(controller.getSnapshot().frame?.tanks[1]).toMatchObject({ hp: 0, alive: false });
    expect(replayMomentTickV1(replay, replay.moments[0]!)).toBe(0);
    expect(replayMomentTickV1(replay, replay.moments[1]!)).toBe(2);
  });
  it('打开逐 tick 回放，支持拖动、播放到结尾自动停止和关闭', () => {
    const controller = new FriendRoomReplayControllerV1();

    controller.open(replay);
    expect(controller.getSnapshot()).toMatchObject({
      open: true,
      playing: false,
      frameIndex: 0,
      replay: { modeName: '歼灭决斗' },
      frame: { tick: 0 },
    });

    controller.seek(1);
    expect(controller.getSnapshot()).toMatchObject({ frameIndex: 1, frame: { tick: 1 } });
    controller.play();
    expect(controller.advance()).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ playing: false, frameIndex: 2, frame: { tick: 2 } });

    controller.close();
    expect(controller.getSnapshot()).toEqual({ open: false, playing: false, frameIndex: 0 });
  });

  it('拒绝没有帧的回放和越界跳转', () => {
    const controller = new FriendRoomReplayControllerV1();
    expect(() => controller.open({ ...replay, frames: [] })).toThrow('回放没有可播放的战斗帧');
    controller.open(replay);
    expect(() => controller.seek(3)).toThrow('回放位置无效');
  });
});
