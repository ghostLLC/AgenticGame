import { describe, expect, it } from 'vitest';
import { createSavedBuildV2, type SavedBuildV2 } from '../src/config/saved-build-v2.js';
import type { MatchBundleV2 } from '../src/replay/v2.js';
import {
  FriendRoomGuestSessionV1,
  FriendRoomHostSessionV1,
  type FriendRoomPeerV1,
} from '../src/friend-room/session-v1.js';
import {
  FriendDataChannelPeerV1,
  type FriendDataChannelLikeV1,
} from '../src/friend-room/data-channel-peer-v1.js';

const passiveSource = `module.exports = () => ({ onTick() { return { throttle: 0, bodyTurn: 0, turretTurn: 0, fire: false }; } });`;
const movingSource = `module.exports = () => ({ onTick() { return { throttle: 1, bodyTurn: 0, turretTurn: 0, fire: false }; } });`;

function build(buildId: string, label: string, source: string): SavedBuildV2 {
  return createSavedBuildV2({
    buildId,
    label,
    bot: {
      artifactId: `${buildId}-bot`,
      version: '1.0.0',
      language: 'javascript',
      entryPoint: `${buildId}.js`,
      source,
    },
    loadout: { vehicleId: 'scout', weaponId: 'light-cannon', equipmentIds: [] },
  }, {
    revision: 1,
    parentFingerprint: null,
    createdAt: '2026-08-26T00:00:00.000Z',
  });
}

function memoryPeerPair(): [FriendRoomPeerV1, FriendRoomPeerV1] {
  const firstListeners = new Set<(payload: string) => void>();
  const secondListeners = new Set<(payload: string) => void>();
  return [
    {
      send: (payload) => secondListeners.forEach((listener) => listener(payload)),
      subscribe: (listener) => {
        firstListeners.add(listener);
        return () => firstListeners.delete(listener);
      },
    },
    {
      send: (payload) => firstListeners.forEach((listener) => listener(payload)),
      subscribe: (listener) => {
        secondListeners.add(listener);
        return () => secondListeners.delete(listener);
      },
    },
  ];
}

describe('好友房间 P2P v1', () => {
  it('通过点对点通道自动同步 Build，并且双方公开快照不暴露源码', () => {
    const [hostPeer, guestPeer] = memoryPeerPair();
    const host = new FriendRoomHostSessionV1({
      peer: hostPeer,
      sessionId: 'friend-session-1',
      displayName: '乐淳',
      createdAt: () => '2026-08-26T00:01:00.000Z',
      maxTicks: 4,
    });
    const guest = new FriendRoomGuestSessionV1({ peer: guestPeer, displayName: 'Ghost' });

    host.selectBuild(build('host-build', '稳健侦察', passiveSource));
    guest.selectBuild(build('guest-build', '快速推进', movingSource));

    expect(host.getSnapshot()).toMatchObject({
      authority: 'host-device',
      trustModel: 'trusted-friends',
      status: 'configuring',
      participants: [
        { seat: 'host', displayName: '乐淳', connected: true, build: { buildId: 'host-build', label: '稳健侦察' } },
        { seat: 'guest', displayName: 'Ghost', connected: true, build: { buildId: 'guest-build', label: '快速推进' } },
      ],
    });
    expect(guest.getSnapshot()).toEqual(host.getSnapshot());
    expect(JSON.stringify(host.getSnapshot())).not.toContain('module.exports');
    expect(JSON.stringify(guest.getSnapshot())).not.toContain('codeHash');
  });

  it('Build 变化会清除准备状态，并且只在房主设备启动一次真实比赛', async () => {
    const [hostPeer, guestPeer] = memoryPeerPair();
    let starts = 0;
    let bundle: MatchBundleV2 | undefined;
    const host = new FriendRoomHostSessionV1({
      peer: hostPeer,
      sessionId: 'friend-session-2',
      displayName: 'Host',
      createdAt: () => '2026-08-26T00:01:00.000Z',
      maxTicks: 4,
      tickBudgetMs: 100,
      runMatch: async (input) => {
        starts += 1;
        return input.runDefault();
      },
      onBundle: (value) => { bundle = value; },
    });
    const guest = new FriendRoomGuestSessionV1({ peer: guestPeer, displayName: 'Guest' });

    host.selectBuild(build('host-build', 'Host v1', passiveSource));
    guest.selectBuild(build('guest-build', 'Guest v1', movingSource));
    guest.setReady(true);
    guest.selectBuild(build('guest-build-2', 'Guest v2', passiveSource));
    expect(host.getSnapshot().participants[1]?.ready).toBe(false);

    host.setReady(true);
    guest.setReady(true);
    expect(host.getSnapshot().status).toBe('running');
    await host.waitForSettlement();

    expect(starts).toBe(1);
    expect(bundle?.integrity.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(host.getSnapshot()).toEqual(guest.getSnapshot());
    expect(host.getSnapshot()).toMatchObject({
      status: 'complete',
      result: { reason: 'max-ticks', ticks: 4 },
      replay: {
        map: { id: 'frontier-v2', width: 32, height: 24 },
        frames: expect.arrayContaining([expect.objectContaining({
          tick: 0,
          tanks: expect.arrayContaining([
            expect.objectContaining({ teamId: 'current' }),
            expect.objectContaining({ teamId: 'historical' }),
          ]),
        })]),
      },
    });
    expect(host.getSnapshot().replay?.frames).toHaveLength(5);
    expect(JSON.stringify(host.getSnapshot().replay)).not.toMatch(/module\.exports|codeHash|bundleHash|[0-9a-f]{64}/);
  });

  it('拒绝篡改 Build 和客人伪造的房主消息，且不污染房间状态', () => {
    const [hostPeer, guestPeer] = memoryPeerPair();
    const host = new FriendRoomHostSessionV1({
      peer: hostPeer,
      sessionId: 'friend-session-3',
      displayName: 'Host',
      maxTicks: 4,
    });
    const guest = new FriendRoomGuestSessionV1({ peer: guestPeer, displayName: 'Guest' });
    const tampered = structuredClone(build('guest-build', 'Guest', movingSource));
    tampered.loadout.vehicleId = 'heavy';

    expect(() => guest.selectBuild(tampered)).toThrow('Invalid SavedBuildV2');
    guestPeer.send(JSON.stringify({
      protocol: 'agentic-game-friend-room',
      version: 1,
      type: 'snapshot',
      snapshot: { status: 'complete' },
    }));

    expect(host.getSnapshot().status).toBe('configuring');
    expect(host.getSnapshot().participants[1]?.build).toBeUndefined();
    expect(guest.getLastError()).toMatchObject({ code: 'invalid-message' });
  });

  it('断线时取消准备，并允许同一房间恢复后保留双方 Build', () => {
    const [hostPeer, guestPeer] = memoryPeerPair();
    const host = new FriendRoomHostSessionV1({
      peer: hostPeer,
      sessionId: 'friend-session-recovery',
      displayName: 'Host',
      maxTicks: 4,
    });
    const guest = new FriendRoomGuestSessionV1({ peer: guestPeer, displayName: 'Guest' });

    host.selectBuild(build('host-build', 'Host v1', passiveSource));
    guest.selectBuild(build('guest-build', 'Guest v1', movingSource));
    host.setReady(true);

    host.markPeerDisconnected();
    expect(host.getSnapshot()).toMatchObject({
      participants: [
        { seat: 'host', connected: true, ready: false, build: { buildId: 'host-build' } },
        { seat: 'guest', connected: false, ready: false, build: { buildId: 'guest-build' } },
      ],
    });

    guest.resume();
    expect(host.getSnapshot()).toMatchObject({
      status: 'configuring',
      participants: [
        { seat: 'host', connected: true, ready: false, build: { buildId: 'host-build' } },
        { seat: 'guest', connected: true, ready: false, build: { buildId: 'guest-build' } },
      ],
    });
    expect(guest.getSnapshot()).toEqual(host.getSnapshot());
  });

  it('把默认 120 回合完整回放控制在单条 DataChannel 消息上限内', async () => {
    const [hostPeer, guestPeer] = memoryPeerPair();
    const host = new FriendRoomHostSessionV1({
      peer: hostPeer,
      sessionId: 'friend-session-full-replay',
      displayName: 'Host',
      maxTicks: 120,
      tickBudgetMs: 100,
    });
    const guest = new FriendRoomGuestSessionV1({ peer: guestPeer, displayName: 'Guest' });
    host.selectBuild(build('host-build', 'Host', passiveSource));
    guest.selectBuild(build('guest-build', 'Guest', passiveSource));
    host.setReady(true);
    guest.setReady(true);

    await host.waitForSettlement();

    const snapshot = host.getSnapshot();
    expect(snapshot.replay?.frames).toHaveLength(121);
    expect(JSON.stringify(snapshot).length).toBeLessThan(900_000);
  });
});

class LinkedDataChannel implements FriendDataChannelLikeV1 {
  readonly readyState = 'open';
  peer?: LinkedDataChannel;
  sentFrames = 0;
  private readonly listeners = new Set<(event: { data: unknown }) => void>();

  send(data: string): void {
    this.sentFrames += 1;
    this.peer?.listeners.forEach((listener) => listener({ data }));
  }

  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void {
    if (type === 'message') this.listeners.delete(listener);
  }
}

describe('FriendDataChannelPeerV1', () => {
  it('把较大的 Unicode 协议消息分帧，并在另一端无损重组', () => {
    const first = new LinkedDataChannel();
    const second = new LinkedDataChannel();
    first.peer = second;
    second.peer = first;
    const sender = new FriendDataChannelPeerV1(first, { frameCharacters: 256, maxMessageCharacters: 100_000 });
    const receiver = new FriendDataChannelPeerV1(second, { frameCharacters: 256, maxMessageCharacters: 100_000 });
    const received: string[] = [];
    receiver.subscribe((payload) => received.push(payload));
    const payload = JSON.stringify({ type: 'build', source: '坦克🤖'.repeat(5_000) });

    sender.send(payload);

    expect(first.sentFrames).toBeGreaterThan(1);
    expect(received).toEqual([payload]);
    expect(() => sender.send('x'.repeat(100_001))).toThrow('Peer message is too large');
  });
});
