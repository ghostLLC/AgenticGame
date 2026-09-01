import { afterEach, describe, expect, it } from 'vitest';
import {
  LanDiscoveryServiceV1,
  NodeLanDatagramAdapterV1,
  assertLanDiscoveryPacketV1,
  type LanDatagramAdapterV1,
  type LanDatagramEndpointV1,
} from '../src/desktop/lan-discovery-v1.js';

class FakeLanNetwork {
  private readonly members = new Map<number, FakeDatagram>();
  private nextPort = 41000;

  create(): FakeDatagram {
    const transport = new FakeDatagram(this, this.nextPort++);
    return transport;
  }

  add(transport: FakeDatagram): void { this.members.set(transport.port, transport); }
  remove(transport: FakeDatagram): void { this.members.delete(transport.port); }
  broadcast(source: FakeDatagram, payload: Buffer): void {
    for (const member of this.members.values()) member.deliver(payload, { address: '192.168.1.20', port: source.port });
  }
  send(endpoint: LanDatagramEndpointV1, payload: Buffer): void {
    this.members.get(endpoint.port)?.deliver(payload, { address: '192.168.1.21', port: endpoint.port });
  }
}

class FakeDatagram implements LanDatagramAdapterV1 {
  private listener?: (payload: Buffer, endpoint: LanDatagramEndpointV1) => void;
  stopped = false;
  constructor(private readonly network: FakeLanNetwork, readonly port: number) {}
  async start(listener: (payload: Buffer, endpoint: LanDatagramEndpointV1) => void): Promise<void> {
    this.listener = listener;
    this.stopped = false;
    this.network.add(this);
  }
  broadcast(payload: Buffer): void { this.network.broadcast(this, payload); }
  send(payload: Buffer, endpoint: LanDatagramEndpointV1): void { this.network.send(endpoint, payload); }
  stop(): void { this.stopped = true; this.listener = undefined; this.network.remove(this); }
  getPort(): number { return this.port; }
  deliver(payload: Buffer, endpoint: LanDatagramEndpointV1): void { this.listener?.(payload, endpoint); }
}

const services: LanDiscoveryServiceV1[] = [];
const adapters: NodeLanDatagramAdapterV1[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const adapter of adapters.splice(0)) adapter.stop();
});

describe('LAN discovery v1 contract', () => {
  it('只接受带随机 nonce、会话、协议版本和显示名的严格发现包', () => {
    const valid = {
      protocol: 'agentic-game-lan-discovery', version: 1, type: 'offer',
      discoveryId: 'discover-20260901', nonce: 'abcdefghijklmnopqrstuv',
      sessionId: 'friend-lan-1', friendRoomProtocolVersion: 1,
      displayName: '乐淳', invitationCard: 'AGFR2.abc123',
      expiresAt: '2026-09-01T12:00:30.000Z',
    };
    expect(assertLanDiscoveryPacketV1(valid)).toEqual(valid);
    expect(() => assertLanDiscoveryPacketV1({ ...valid, botSource: 'module.exports = 1' }))
      .toThrow('附近好友消息结构无效');
    expect(() => assertLanDiscoveryPacketV1({ ...valid, nonce: 'short' }))
      .toThrow('附近好友消息结构无效');
    expect(JSON.stringify(valid)).not.toMatch(/module\.exports|codeHash|api.?key/i);
  });
});

describe('LanDiscoveryServiceV1', () => {
  it('发现附近房主并把加入确认只路由回原 nonce，不需要外部服务器', async () => {
    const network = new FakeLanNetwork();
    const hostTransport = network.create();
    const guestTransport = network.create();
    const hostConfirmations: string[] = [];
    const nearby: string[][] = [];
    const host = new LanDiscoveryServiceV1(hostTransport, {
      now: () => '2026-09-01T12:00:00.000Z',
      createDiscoveryId: () => 'discover-20260901',
      createNonce: () => 'abcdefghijklmnopqrstuv',
      schedule: () => 1,
      cancelSchedule: () => undefined,
    });
    const guest = new LanDiscoveryServiceV1(guestTransport, {
      now: () => '2026-09-01T12:00:00.000Z', schedule: () => 2, cancelSchedule: () => undefined,
    });
    services.push(host, guest);
    await host.start({ onNearbyChanged: () => undefined, onConfirmation: (answer) => hostConfirmations.push(answer.joinConfirmation) });
    await guest.start({ onNearbyChanged: (cards) => nearby.push(cards.map((card) => card.displayName)), onConfirmation: () => undefined });

    host.publishHost({
      sessionId: 'friend-lan-1', displayName: '乐淳', invitationCard: 'AGFR2.host-offer',
    });

    expect(nearby.at(-1)).toEqual(['乐淳']);
    expect(guest.listNearby()).toEqual([expect.objectContaining({
      discoveryId: 'discover-20260901', sessionId: 'friend-lan-1', displayName: '乐淳',
      invitationCard: 'AGFR2.host-offer',
    })]);

    guest.sendJoinConfirmation({
      discoveryId: 'discover-20260901', displayName: 'Ghost', joinConfirmation: 'AGFR2.guest-answer',
    });
    expect(hostConfirmations).toEqual(['AGFR2.guest-answer']);

    const forged = Buffer.from(JSON.stringify({
      protocol: 'agentic-game-lan-discovery', version: 1, type: 'answer',
      discoveryId: 'discover-20260901', nonce: 'zzzzzzzzzzzzzzzzzzzzzz', sessionId: 'friend-lan-1',
      friendRoomProtocolVersion: 1, displayName: 'Mallory', joinConfirmation: 'AGFR2.forged',
    }));
    hostTransport.deliver(forged, { address: '192.168.1.99', port: guestTransport.port });
    expect(hostConfirmations).toEqual(['AGFR2.guest-answer']);
  });

  it('忽略过期发现、去重刷新，并在停止后立即清空且不再收发', async () => {
    const network = new FakeLanNetwork();
    const transport = network.create();
    let now = '2026-09-01T12:00:00.000Z';
    const changes: number[] = [];
    const service = new LanDiscoveryServiceV1(transport, {
      now: () => now, schedule: () => 1, cancelSchedule: () => undefined,
    });
    services.push(service);
    await service.start({ onNearbyChanged: (cards) => changes.push(cards.length), onConfirmation: () => undefined });
    const offer = Buffer.from(JSON.stringify({
      protocol: 'agentic-game-lan-discovery', version: 1, type: 'offer',
      discoveryId: 'discover-expiry', nonce: 'abcdefghijklmnopqrstuv', sessionId: 'friend-lan-expiry',
      friendRoomProtocolVersion: 1, displayName: 'Nearby', invitationCard: 'AGFR2.offer',
      expiresAt: '2026-09-01T12:00:01.000Z',
    }));
    transport.deliver(offer, { address: '192.168.1.30', port: 45873 });
    transport.deliver(offer, { address: '192.168.1.30', port: 45873 });
    expect(service.listNearby()).toHaveLength(1);

    now = '2026-09-01T12:00:02.000Z';
    service.pruneExpired();
    expect(service.listNearby()).toEqual([]);

    service.stop();
    expect(transport.stopped).toBe(true);
    transport.deliver(offer, { address: '192.168.1.30', port: 45873 });
    expect(service.listNearby()).toEqual([]);
    expect(changes).toContain(0);
  });
});

describe('NodeLanDatagramAdapterV1', () => {
  it('在真实 UDP localhost 回环中传递消息并可立即停止', async () => {
    const receiver = new NodeLanDatagramAdapterV1({ port: 0, broadcastAddress: '127.0.0.1' });
    const sender = new NodeLanDatagramAdapterV1({ port: 0, broadcastAddress: '127.0.0.1' });
    adapters.push(receiver, sender);
    let resolveMessage!: (value: string) => void;
    const message = new Promise<string>((resolve) => { resolveMessage = resolve; });
    await receiver.start((payload) => resolveMessage(payload.toString('utf8')));
    await sender.start(() => undefined);

    sender.send(Buffer.from('nearby-loopback'), { address: '127.0.0.1', port: receiver.getPort() });

    await expect(message).resolves.toBe('nearby-loopback');
    receiver.stop();
    sender.stop();
  });
});
