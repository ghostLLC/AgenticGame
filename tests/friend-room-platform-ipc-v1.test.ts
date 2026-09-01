import { describe, expect, it } from 'vitest';
import {
  createFriendRoomPlatformPreloadApiV1,
  registerFriendRoomPlatformIpcV1,
  type FriendRoomPlatformHandlerV1,
  type FriendRoomPlatformServiceBoundaryV1,
} from '../src/desktop/friend-room-platform-ipc-v1.js';

describe('好友房间平台 IPC v1', () => {
  it('只注册固定用途操作，并在服务前拒绝路径、未知字段和未确认退出', async () => {
    const calls: string[] = [];
    const service: FriendRoomPlatformServiceBoundaryV1 = {
      inspectRecovery: async () => ({ status: 'missing' }),
      restoreRoom: async (senderId) => { calls.push(`restore:${senderId}`); },
      leaveRoom: async (senderId) => { calls.push(`leave:${senderId}`); },
      runDiagnostics: async () => ({ version: 1, generatedAt: '2026-09-01T12:00:00.000Z', items: [] }),
      startNearby: async (senderId) => { calls.push(`start:${senderId}`); },
      publishNearby: (senderId, input) => { calls.push(`publish:${senderId}:${input.sessionId}`); },
      sendNearbyConfirmation: (senderId, input) => { calls.push(`confirm:${senderId}:${input.discoveryId}`); },
      stopNearby: (senderId) => { calls.push(`stop:${senderId}`); },
    };
    const handlers = new Map<string, FriendRoomPlatformHandlerV1>();
    registerFriendRoomPlatformIpcV1({ handle: (channel, handler) => handlers.set(channel, handler) }, service);

    expect([...handlers.keys()]).toEqual([
      'friend-room:recovery-inspect',
      'friend-room:restore',
      'friend-room:leave',
      'friend-room:diagnostics',
      'friend-room:nearby-start',
      'friend-room:nearby-publish',
      'friend-room:nearby-confirm',
      'friend-room:nearby-stop',
    ]);
    const event = { sender: { id: 7 } };
    await expect(handlers.get('friend-room:nearby-publish')?.(event, {
      sessionId: 'friend-lan-1', displayName: '乐淳', invitationCard: 'AGFR2.offer', path: 'C:\\secrets',
    })).rejects.toThrow('附近好友邀请无效');
    await expect(handlers.get('friend-room:nearby-confirm')?.(event, {
      discoveryId: '../escape', displayName: 'Ghost', joinConfirmation: 'AGFR2.answer',
    })).rejects.toThrow('附近好友确认无效');
    await expect(handlers.get('friend-room:leave')?.(event, false)).rejects.toThrow('需要明确确认退出房间');
    expect(calls).toEqual([]);
  });

  it('preload 把玩家操作映射到固定 IPC，且不暴露通用调用器', async () => {
    const calls: Array<[string, unknown?]> = [];
    const api = createFriendRoomPlatformPreloadApiV1(async (channel, input) => {
      calls.push([channel, input]);
      return channel === 'friend-room:recovery-inspect' ? { status: 'missing' } : undefined;
    });

    await api.inspectRecovery();
    await api.restore();
    await api.leave(true);
    await api.runDiagnostics();
    await api.startNearby();
    await api.publishNearby({ sessionId: 'friend-lan-1', displayName: '乐淳', invitationCard: 'AGFR2.offer' });
    await api.sendNearbyConfirmation({ discoveryId: 'discover-1', displayName: 'Ghost', joinConfirmation: 'AGFR2.answer' });
    await api.stopNearby();

    expect(calls).toEqual([
      ['friend-room:recovery-inspect', undefined],
      ['friend-room:restore', undefined],
      ['friend-room:leave', true],
      ['friend-room:diagnostics', undefined],
      ['friend-room:nearby-start', undefined],
      ['friend-room:nearby-publish', { sessionId: 'friend-lan-1', displayName: '乐淳', invitationCard: 'AGFR2.offer' }],
      ['friend-room:nearby-confirm', { discoveryId: 'discover-1', displayName: 'Ghost', joinConfirmation: 'AGFR2.answer' }],
      ['friend-room:nearby-stop', undefined],
    ]);
    expect(api).not.toHaveProperty('invoke');
  });
});
