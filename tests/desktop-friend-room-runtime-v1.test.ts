import { describe, expect, it } from 'vitest';
import {
  DesktopFriendRoomRuntimeV1,
  friendRoomPresetOptionsV1,
  type DesktopFriendRoomEventV1,
} from '../src/desktop/friend-room-runtime-v1.js';

describe('桌面好友房间比赛运行时 v1', () => {
  it('只向玩家暴露三套可选战术，不暴露代码或协议字段', () => {
    const presets = friendRoomPresetOptionsV1();
    expect(presets.map((item) => item.label)).toEqual(['游骑侦察队', '中线突击队', '钢铁堡垒队']);
    expect(JSON.stringify(presets)).not.toMatch(/source|module\.exports|protocol|hash/i);
  });

  it('在两台桌面客户端间同步战术与准备状态，并由房主完成比赛', async () => {
    let host!: DesktopFriendRoomRuntimeV1;
    let guest!: DesktopFriendRoomRuntimeV1;
    const hostEvents: DesktopFriendRoomEventV1[] = [];
    const guestEvents: DesktopFriendRoomEventV1[] = [];

    host = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => guest.receivePeer(payload),
      onEvent: (event) => hostEvents.push(event),
      createdAt: () => '2026-08-27T00:00:00.000Z',
      maxTicks: 8,
    });
    guest = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => host.receivePeer(payload),
      onEvent: (event) => guestEvents.push(event),
      createdAt: () => '2026-08-27T00:00:00.000Z',
      maxTicks: 8,
    });

    host.start({ role: 'host', sessionId: 'friend-desktop-1', displayName: '乐淳' });
    guest.start({ role: 'guest', displayName: 'Ghost' });
    host.selectPreset('scout');
    guest.selectPreset('heavy');
    host.setReady(true);
    guest.setReady(true);

    await host.waitForSettlement();

    const hostComplete = hostEvents.findLast((event) => event.snapshot?.status === 'complete');
    const guestComplete = guestEvents.findLast((event) => event.snapshot?.status === 'complete');
    expect(hostComplete?.snapshot).toEqual(guestComplete?.snapshot);
    expect(hostComplete?.snapshot).toMatchObject({
      status: 'complete',
      participants: [
        { displayName: '乐淳', ready: true, build: { label: '游骑侦察队' } },
        { displayName: 'Ghost', ready: true, build: { label: '钢铁堡垒队' } },
      ],
      result: { ticks: 8 },
    });

    const rematchEventStart = hostEvents.length;
    host.requestRematch();
    expect(hostEvents.at(-1)?.snapshot?.status).toBe('complete');
    expect(hostEvents.at(-1)?.snapshot?.participants[0]).toMatchObject({ seat: 'host', rematchRequested: true });
    guest.requestRematch();
    expect(hostEvents.at(-1)?.snapshot).toMatchObject({
      status: 'configuring',
      participants: [
        { seat: 'host', ready: false, rematchRequested: false, build: { label: '游骑侦察队' } },
        { seat: 'guest', ready: false, rematchRequested: false, build: { label: '钢铁堡垒队' } },
      ],
    });
    expect(hostEvents.at(-1)?.snapshot?.result).toBeUndefined();

    host.setReady(true);
    guest.setReady(true);
    await host.waitForSettlement();
    expect(hostEvents.slice(rematchEventStart).map((event) => event.snapshot?.status).filter(Boolean))
      .toEqual(expect.arrayContaining(['configuring', 'running', 'complete']));
    expect(hostEvents.at(-1)?.snapshot?.status).toBe('complete');
  });

  it('双方各自保存一次公开回放，重赛产生新记录且保存失败不破坏比赛结果', async () => {
    let host!: DesktopFriendRoomRuntimeV1;
    let guest!: DesktopFriendRoomRuntimeV1;
    const hostSaved: string[] = [];
    const guestSaved: string[] = [];
    const hostEvents: DesktopFriendRoomEventV1[] = [];
    host = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => guest.receivePeer(payload),
      onEvent: (event) => hostEvents.push(event),
      onPublicReplay: async (input) => { hostSaved.push(input.completionKey); },
      createdAt: () => '2026-08-27T00:00:00.000Z', maxTicks: 4,
    });
    guest = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => host.receivePeer(payload),
      onEvent: () => undefined,
      onPublicReplay: async (input) => { guestSaved.push(input.completionKey); },
      createdAt: () => '2026-08-27T00:00:00.000Z', maxTicks: 4,
    });
    host.start({ role: 'host', sessionId: 'friend-persist', displayName: '乐淳' });
    guest.start({ role: 'guest', displayName: 'Ghost' });
    host.selectPreset('scout'); guest.selectPreset('heavy');
    host.setReady(true); guest.setReady(true);
    await host.waitForSettlement();
    await guest.waitForPersistence();
    expect(hostSaved).toHaveLength(1);
    expect(guestSaved).toEqual(hostSaved);

    host.requestRematch(); guest.requestRematch();
    host.setReady(true); guest.setReady(true);
    await host.waitForSettlement();
    await guest.waitForPersistence();
    expect(hostSaved).toHaveLength(2);
    expect(new Set(hostSaved).size).toBe(2);
    expect(guestSaved).toEqual(hostSaved);

    const failingEvents: DesktopFriendRoomEventV1[] = [];
    const failing = new DesktopFriendRoomRuntimeV1({
      sendPeer: () => undefined,
      onEvent: (event) => failingEvents.push(event),
      onPublicReplay: async () => { throw new Error('disk full'); },
    });
    const complete = hostEvents.findLast((event) => event.snapshot?.status === 'complete')!.snapshot!;
    failing.start({ role: 'guest', displayName: 'Solo' });
    failing.receivePeer(JSON.stringify({
      protocol: 'agentic-game-friend-room', version: 1, type: 'snapshot', snapshot: complete,
    }));
    await failing.waitForPersistence();
    expect(failingEvents.at(-2)).toMatchObject({ kind: 'snapshot', snapshot: { status: 'complete', result: expect.any(Object) } });
    expect(failingEvents.at(-1)).toEqual({ kind: 'error', message: '比赛已经结束，但回放未能保存。' });
  });

  it('换用新连接后恢复原房间，不要求双方重新选择战术', () => {
    let host!: DesktopFriendRoomRuntimeV1;
    let guest!: DesktopFriendRoomRuntimeV1;
    const hostEvents: DesktopFriendRoomEventV1[] = [];

    host = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => guest.receivePeer(payload),
      onEvent: (event) => hostEvents.push(event),
      createdAt: () => '2026-08-27T00:00:00.000Z',
      maxTicks: 8,
    });
    guest = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => host.receivePeer(payload),
      onEvent: () => undefined,
      createdAt: () => '2026-08-27T00:00:00.000Z',
      maxTicks: 8,
    });

    host.start({ role: 'host', sessionId: 'friend-desktop-recovery', displayName: '乐淳' });
    guest.start({ role: 'guest', displayName: 'Ghost' });
    host.selectPreset('medium');
    guest.selectPreset('heavy');
    host.setReady(true);

    host.transportClosed();
    expect(hostEvents.at(-1)?.snapshot).toMatchObject({
      participants: [
        { seat: 'host', ready: false, build: { label: '中线突击队' } },
        { seat: 'guest', connected: false, ready: false, build: { label: '钢铁堡垒队' } },
      ],
    });

    guest.resumeTransport();
    expect(hostEvents.at(-1)?.snapshot).toMatchObject({
      status: 'configuring',
      participants: [
        { seat: 'host', build: { label: '中线突击队' } },
        { seat: 'guest', connected: true, build: { label: '钢铁堡垒队' } },
      ],
    });
  });
});
