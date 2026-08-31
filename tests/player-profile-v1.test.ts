import { describe, expect, it } from 'vitest';
import {
  assertPlayerProfileV1,
  createPlayerProfileV1,
  type PlayerProfileV1,
} from '../src/desktop/player-profile-v1.js';

const validProfile: PlayerProfileV1 = {
  version: 1,
  playerId: '11111111-1111-4111-8111-111111111111',
  displayName: '乐淳',
  doctrine: 'scout',
  tutorialStage: 'battle',
  recentPage: 'command-center',
  createdAt: '2026-08-31T10:00:00.000Z',
  lastOpenedAt: '2026-08-31T10:00:00.000Z',
};

describe('PlayerProfileV1', () => {
  it('创建带可恢复教程阶段的严格首次档案', () => {
    expect(createPlayerProfileV1({
      playerId: '11111111-1111-4111-8111-111111111111',
      displayName: '  乐淳  ',
      doctrine: 'scout',
      now: '2026-08-31T10:00:00.000Z',
    })).toEqual(validProfile);
  });

  it.each([
    ['未知字段', { ...validProfile, unexpected: true }],
    ['空昵称', { ...validProfile, displayName: '   ' }],
    ['过长昵称', { ...validProfile, displayName: '1234567890123456789012345' }],
    ['无效玩家编号', { ...validProfile, playerId: 'player-1' }],
    ['无效战术', { ...validProfile, doctrine: 'sniper' }],
    ['无效教程阶段', { ...validProfile, tutorialStage: 'welcome' }],
    ['无效页面', { ...validProfile, recentPage: 'developer-console' }],
    ['无效时间', { ...validProfile, lastOpenedAt: 'today' }],
    ['时间倒退', { ...validProfile, lastOpenedAt: '2026-08-31T09:59:59.999Z' }],
  ])('拒绝%s', (_label, input) => {
    expect(() => assertPlayerProfileV1(input)).toThrow('Invalid PlayerProfileV1');
  });

  it('接受从磁盘读取的完整合法档案并返回独立副本', () => {
    const parsed = assertPlayerProfileV1(structuredClone(validProfile));
    expect(parsed).toEqual(validProfile);
    expect(parsed).not.toBe(validProfile);
  });
});
