import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicReplayRepositoryV1 } from '../src/desktop/public-replay-repository-v1.js';
import { assertFriendRoomReplayV1, type FriendRoomReplayV1 } from '../src/friend-room/replay-v1.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function replay(): FriendRoomReplayV1 {
  return {
    version: 1,
    modeName: '歼灭决斗',
    map: { id: 'frontier', width: 12, height: 8, terrainCells: [], captureZones: [] },
    participants: [
      { teamId: 'current', displayName: '乐淳', vehicleName: '游骑坦克', weaponName: '轻型炮' },
      { teamId: 'historical', displayName: 'Ghost', vehicleName: '堡垒坦克', weaponName: '重型炮' },
    ],
    result: { winningTeamIds: ['current'], reason: 'elimination', ticks: 1 },
    moments: [
      { tick: 0, kind: 'start', title: '比赛开始', summary: '乐淳 vs Ghost', teamIds: ['current', 'historical'] },
      { tick: 1, kind: 'result', title: '比赛结束', summary: '乐淳获胜', teamIds: ['current'] },
    ],
    frames: [
      {
        tick: 0,
        tanks: [
          { teamId: 'current', displayName: '乐淳', vehicleName: '游骑坦克', x: 1, y: 1, hp: 100, maxHp: 100, bodyDirection: 0, turretDirection: 0, ammunition: 10, alive: true },
          { teamId: 'historical', displayName: 'Ghost', vehicleName: '堡垒坦克', x: 10, y: 6, hp: 100, maxHp: 100, bodyDirection: 4, turretDirection: 4, ammunition: 8, alive: true },
        ],
        projectiles: [], objective: null,
      },
      {
        tick: 1,
        tanks: [
          { teamId: 'current', displayName: '乐淳', vehicleName: '游骑坦克', x: 2, y: 1, hp: 100, maxHp: 100, bodyDirection: 0, turretDirection: 0, ammunition: 9, alive: true },
          { teamId: 'historical', displayName: 'Ghost', vehicleName: '堡垒坦克', x: 10, y: 6, hp: 0, maxHp: 100, bodyDirection: 4, turretDirection: 4, ammunition: 8, alive: false },
        ],
        projectiles: [], objective: null,
      },
    ],
  };
}

describe('FriendRoomReplayV1 strict public contract', () => {
  it('accepts canonical player data and rejects hidden, unknown or oversized content', () => {
    expect(assertFriendRoomReplayV1(replay())).toEqual(replay());
    expect(() => assertFriendRoomReplayV1({ ...replay(), source: 'module.exports = {}' })).toThrow('Invalid FriendRoomReplayV1');
    expect(() => assertFriendRoomReplayV1({ ...replay(), bundleHash: 'a'.repeat(64) })).toThrow('Invalid FriendRoomReplayV1');
    expect(() => assertFriendRoomReplayV1({ ...replay(), frames: [] })).toThrow('Invalid FriendRoomReplayV1');
    expect(() => assertFriendRoomReplayV1({ ...replay(), frames: Array(20_001).fill(replay().frames[0]) })).toThrow('Invalid FriendRoomReplayV1');
    const badFrame = { ...replay().frames[0], tanks: [{ ...replay().frames[0]!.tanks[0], x: -1 }] };
    expect(() => assertFriendRoomReplayV1({ ...replay(), frames: [badFrame] })).toThrow('Invalid FriendRoomReplayV1');
  });
});

describe('PublicReplayRepositoryV1', () => {
  it('saves atomically, loads strictly and deduplicates the same completed revision', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentic-game-public-replay-'));
    roots.push(root);
    const repository = new PublicReplayRepositoryV1(root);
    const input = {
      replay: replay(),
      createdAt: '2026-09-01T10:00:00.000Z',
      localTeamId: 'current',
      completionKey: 'b'.repeat(64),
    };
    const first = await repository.save(input);
    const second = await repository.save(input);

    expect(first).toEqual({ created: true, replayId: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(second).toEqual({ created: false, replayId: first.replayId });
    expect(await repository.load(first.replayId)).toEqual(replay());
    expect(await repository.inspect()).toEqual([
      expect.objectContaining({
        replayId: first.replayId, state: 'healthy', createdAt: input.createdAt,
        localTeamId: 'current', modeName: '歼灭决斗', participantNames: ['乐淳', 'Ghost'],
      }),
    ]);
    expect(readFileSync(repository.filePath(first.replayId), 'utf8')).not.toMatch(/module\.exports|bundleHash|actions|logs|codeHash/);
    expect(() => repository.filePath('../escape')).toThrow('Invalid public replay ID');
  });
});
