import { describe, expect, it } from 'vitest';
import {
  DesktopFriendRoomRuntimeV1,
  friendRoomPresetOptionsV1,
  type DesktopFriendRoomEventV1,
} from '../src/desktop/friend-room-runtime-v1.js';
import type { FriendRoomRecoveryCapsuleV1 } from '../src/desktop/friend-room-recovery-store-v1.js';
import { createPresetBuildV1 } from '../src/desktop/preset-builds-v1.js';
import { createSavedBuildV2 } from '../src/config/saved-build-v2.js';

describe('桌面好友房间比赛运行时 v1', () => {
  it('locks an exact saved custom source and rejects later mutation or tampering', () => {
    const events: DesktopFriendRoomEventV1[] = [];
    let capsule: FriendRoomRecoveryCapsuleV1 | null = null;
    const runtime = new DesktopFriendRoomRuntimeV1({ sendPeer: () => undefined, onEvent: (event) => events.push(event),
      onRecovery: async (value) => { capsule = value; } });
    runtime.start({ role: 'host', sessionId: 'custom-revision', displayName: '自定义玩家' });
    const source = 'module.exports=()=>({onTick(){return {throttle:0,bodyTurn:0,turretTurn:0,fire:false};}});';
    const custom = createSavedBuildV2({ buildId: 'commander-main', label: '自定义守卫',
      bot: { artifactId: 'custom-guard', version: '1.0.0', language: 'javascript', entryPoint: 'guard.js', source },
      loadout: { vehicleId: 'medium', weaponId: 'medium-cannon', equipmentIds: [] } },
      { revision: 1, parentFingerprint: null, createdAt: '2026-09-05T00:00:00.000Z' });
    runtime.selectBuild(custom);
    custom.botArtifact.source = 'module.exports=()=>({});';
    custom.label = '外部变更';
    expect(events.at(-1)?.snapshot?.participants[0]?.build?.label).toBe('自定义守卫');
    expect(JSON.stringify(capsule)).toContain(source);
    expect(() => runtime.selectBuild(custom)).toThrow();
  });
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

  it('生成最小加密胶囊所需状态，并在应用重启后恢复同一房间及双方自己的 Build', () => {
    let host!: DesktopFriendRoomRuntimeV1;
    let guest!: DesktopFriendRoomRuntimeV1;
    const hostCapsules: FriendRoomRecoveryCapsuleV1[] = [];
    const guestCapsules: FriendRoomRecoveryCapsuleV1[] = [];
    host = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => guest.receivePeer(payload),
      onEvent: () => undefined,
      onRecovery: (capsule) => { if (capsule) hostCapsules.push(capsule); },
      createdAt: () => '2026-09-01T10:00:00.000Z', maxTicks: 4,
    });
    guest = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => host.receivePeer(payload),
      onEvent: () => undefined,
      onRecovery: (capsule) => { if (capsule) guestCapsules.push(capsule); },
      createdAt: () => '2026-09-01T10:00:00.000Z', maxTicks: 4,
    });
    host.start({ role: 'host', sessionId: 'friend-restart', displayName: '乐淳' });
    guest.start({ role: 'guest', displayName: 'Ghost' });
    host.selectPreset('medium');
    guest.selectPreset('heavy');

    const hostCapsule = hostCapsules.at(-1)!;
    const guestCapsule = guestCapsules.at(-1)!;
    expect(hostCapsule).toMatchObject({
      role: 'host', sessionId: 'friend-restart', displayName: '乐淳',
      ownBuild: { buildId: 'friend-medium' },
      expiresAt: '2026-09-02T10:00:00.000Z',
    });
    expect(guestCapsule).toMatchObject({ role: 'guest', ownBuild: { buildId: 'friend-heavy' } });
    expect(JSON.stringify(hostCapsule.publicSnapshot)).not.toMatch(/source|codeHash|bundleHash/i);

    let restoredHost!: DesktopFriendRoomRuntimeV1;
    let restoredGuest!: DesktopFriendRoomRuntimeV1;
    const restoredHostEvents: DesktopFriendRoomEventV1[] = [];
    restoredHost = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => restoredGuest.receivePeer(payload),
      onEvent: (event) => restoredHostEvents.push(event),
      createdAt: () => '2026-09-01T11:00:00.000Z', maxTicks: 4,
    });
    restoredGuest = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => restoredHost.receivePeer(payload),
      onEvent: () => undefined,
      createdAt: () => '2026-09-01T11:00:00.000Z', maxTicks: 4,
    });

    restoredHost.restore(hostCapsule);
    restoredGuest.restore(guestCapsule);

    expect(restoredHostEvents.at(-1)?.snapshot).toMatchObject({
      sessionId: 'friend-restart',
      status: 'configuring',
      revision: expect.any(Number),
      participants: [
        { seat: 'host', build: { buildId: 'friend-medium' } },
        { seat: 'guest', build: { buildId: 'friend-heavy' } },
      ],
    });
    expect(restoredHostEvents.at(-1)!.snapshot!.revision).toBeGreaterThan(hostCapsule.revision);
  });

  it('房主明确离开会通知客人并清除双方本地恢复入口', () => {
    let host!: DesktopFriendRoomRuntimeV1;
    let guest!: DesktopFriendRoomRuntimeV1;
    const hostRecovery: Array<FriendRoomRecoveryCapsuleV1 | undefined> = [];
    const guestRecovery: Array<FriendRoomRecoveryCapsuleV1 | undefined> = [];
    const guestEvents: DesktopFriendRoomEventV1[] = [];
    host = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => guest.receivePeer(payload), onEvent: () => undefined,
      onRecovery: (value) => hostRecovery.push(value),
    });
    guest = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => host.receivePeer(payload), onEvent: (event) => guestEvents.push(event),
      onRecovery: (value) => guestRecovery.push(value),
    });
    host.start({ role: 'host', sessionId: 'friend-close', displayName: 'Host' });
    guest.start({ role: 'guest', displayName: 'Guest' });
    host.selectPreset('scout');
    guest.selectPreset('heavy');

    host.closeRoom();

    expect(guestEvents.at(-1)?.snapshot).toMatchObject({ status: 'closed', error: '房主已关闭好友房间。' });
    expect(hostRecovery.at(-1)).toBeUndefined();
    expect(guestRecovery.at(-1)).toBeUndefined();
  });

  it('恢复时拒绝会话版本落后于本机胶囊的房主状态', () => {
    const base: FriendRoomRecoveryCapsuleV1 = {
      version: 1,
      role: 'host',
      sessionId: 'friend-stale',
      displayName: 'Host',
      revision: 5,
      createdAt: '2026-09-01T10:00:00.000Z',
      expiresAt: '2026-09-02T10:00:00.000Z',
      ownBuild: createPresetBuildV1('scout', '2026-09-01T10:00:00.000Z'),
      publicSnapshot: {
        status: 'configuring', mapId: 'frontier-v2',
        participants: [{ seat: 'host', displayName: 'Host', connected: true, ready: false }],
      },
    };
    let host!: DesktopFriendRoomRuntimeV1;
    let guest!: DesktopFriendRoomRuntimeV1;
    const guestEvents: DesktopFriendRoomEventV1[] = [];
    host = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => guest.receivePeer(payload), onEvent: () => undefined,
    });
    guest = new DesktopFriendRoomRuntimeV1({
      sendPeer: (payload) => host.receivePeer(payload), onEvent: (event) => guestEvents.push(event),
    });
    host.restore(base);
    guest.restore({ ...base, role: 'guest', displayName: 'Guest', revision: 50 });

    expect(guestEvents.at(-1)).toEqual({ kind: 'error', message: '房间状态早于本机记录，请让房主重新生成会合邀请。' });
  });
});
