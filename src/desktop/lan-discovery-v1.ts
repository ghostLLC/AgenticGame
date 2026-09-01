import { randomBytes, randomUUID } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';

const PROTOCOL = 'agentic-game-lan-discovery';
const VERSION = 1;
const DEFAULT_PORT = 45873;
const MAX_PACKET_BYTES = 60_000;
const MAX_SIGNAL_CHARACTERS = 50_000;
const OFFER_LIFETIME_MS = 30_000;
const MAX_ACCEPTED_FUTURE_MS = 90_000;

export interface LanDatagramEndpointV1 {
  address: string;
  port: number;
}

export interface LanDatagramAdapterV1 {
  start(listener: (payload: Buffer, endpoint: LanDatagramEndpointV1) => void): Promise<void>;
  broadcast(payload: Buffer): void;
  send(payload: Buffer, endpoint: LanDatagramEndpointV1): void;
  stop(): void;
  getPort(): number;
}

export interface LanDiscoveryOfferV1 {
  protocol: typeof PROTOCOL;
  version: 1;
  type: 'offer';
  discoveryId: string;
  nonce: string;
  sessionId: string;
  friendRoomProtocolVersion: 1;
  displayName: string;
  invitationCard: string;
  expiresAt: string;
}

export interface LanDiscoveryAnswerV1 {
  protocol: typeof PROTOCOL;
  version: 1;
  type: 'answer';
  discoveryId: string;
  nonce: string;
  sessionId: string;
  friendRoomProtocolVersion: 1;
  displayName: string;
  joinConfirmation: string;
}

export type LanDiscoveryPacketV1 = LanDiscoveryOfferV1 | LanDiscoveryAnswerV1;

export interface NearbyFriendCardV1 {
  discoveryId: string;
  sessionId: string;
  displayName: string;
  invitationCard: string;
  expiresAt: string;
}

interface DiscoveredPeerV1 {
  card: NearbyFriendCardV1;
  nonce: string;
  endpoint: LanDatagramEndpointV1;
}

export interface LanDiscoveryCallbacksV1 {
  onNearbyChanged(cards: NearbyFriendCardV1[]): void;
  onConfirmation(answer: { displayName: string; joinConfirmation: string }): void;
}

export interface LanDiscoveryServiceOptionsV1 {
  now?: () => string;
  createDiscoveryId?: () => string;
  createNonce?: () => string;
  schedule?: (callback: () => void, milliseconds: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
}

export function assertLanDiscoveryPacketV1(input: unknown): LanDiscoveryPacketV1 {
  if (!isRecord(input) || input.protocol !== PROTOCOL || input.version !== VERSION) {
    throw new Error('附近好友消息结构无效');
  }
  const commonKeys = ['protocol', 'version', 'type', 'discoveryId', 'nonce', 'sessionId', 'friendRoomProtocolVersion', 'displayName'];
  const discoveryId = stableId(input.discoveryId);
  const nonce = validNonce(input.nonce);
  const sessionId = stableId(input.sessionId);
  const displayName = validDisplayName(input.displayName);
  if (input.friendRoomProtocolVersion !== 1) throw new Error('附近好友消息结构无效');
  if (input.type === 'offer') {
    if (!hasExactKeys(input, [...commonKeys, 'invitationCard', 'expiresAt'])) throw new Error('附近好友消息结构无效');
    const invitationCard = validSignal(input.invitationCard);
    const expiresAt = validTime(input.expiresAt);
    return {
      protocol: PROTOCOL, version: 1, type: 'offer', discoveryId, nonce, sessionId,
      friendRoomProtocolVersion: 1, displayName, invitationCard, expiresAt,
    };
  }
  if (input.type === 'answer') {
    if (!hasExactKeys(input, [...commonKeys, 'joinConfirmation'])) throw new Error('附近好友消息结构无效');
    const joinConfirmation = validSignal(input.joinConfirmation);
    return {
      protocol: PROTOCOL, version: 1, type: 'answer', discoveryId, nonce, sessionId,
      friendRoomProtocolVersion: 1, displayName, joinConfirmation,
    };
  }
  throw new Error('附近好友消息结构无效');
}

export class LanDiscoveryServiceV1 {
  private readonly now: () => string;
  private readonly createDiscoveryId: () => string;
  private readonly createNonce: () => string;
  private readonly schedule: (callback: () => void, milliseconds: number) => unknown;
  private readonly cancelSchedule: (handle: unknown) => void;
  private callbacks?: LanDiscoveryCallbacksV1;
  private scheduleHandle?: unknown;
  private hostOffer?: LanDiscoveryOfferV1;
  private readonly nearby = new Map<string, DiscoveredPeerV1>();
  private active = false;

  constructor(private readonly datagram: LanDatagramAdapterV1, options: LanDiscoveryServiceOptionsV1 = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createDiscoveryId = options.createDiscoveryId ?? (() => randomUUID());
    this.createNonce = options.createNonce ?? (() => randomBytes(16).toString('base64url'));
    this.schedule = options.schedule ?? ((callback, milliseconds) => setInterval(callback, milliseconds));
    this.cancelSchedule = options.cancelSchedule ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  }

  async start(callbacks: LanDiscoveryCallbacksV1): Promise<void> {
    if (this.active) throw new Error('附近好友发现已经开启');
    this.callbacks = callbacks;
    await this.datagram.start((payload, endpoint) => this.receive(payload, endpoint));
    this.active = true;
    this.scheduleHandle = this.schedule(() => {
      this.pruneExpired();
      if (this.hostOffer) this.broadcastHost();
    }, 1_500);
  }

  publishHost(input: { sessionId: string; displayName: string; invitationCard: string }): void {
    this.requireActive();
    const nowMs = requireCurrentTime(this.now());
    this.hostOffer = assertLanDiscoveryPacketV1({
      protocol: PROTOCOL,
      version: 1,
      type: 'offer',
      discoveryId: this.createDiscoveryId(),
      nonce: this.createNonce(),
      sessionId: input.sessionId,
      friendRoomProtocolVersion: 1,
      displayName: input.displayName,
      invitationCard: input.invitationCard,
      expiresAt: new Date(nowMs + OFFER_LIFETIME_MS).toISOString(),
    }) as LanDiscoveryOfferV1;
    this.broadcastHost();
  }

  sendJoinConfirmation(input: { discoveryId: string; displayName: string; joinConfirmation: string }): void {
    this.requireActive();
    this.pruneExpired();
    const discovered = this.nearby.get(input.discoveryId);
    if (!discovered) throw new Error('这位附近好友已离线，请重新搜索');
    const packet = assertLanDiscoveryPacketV1({
      protocol: PROTOCOL,
      version: 1,
      type: 'answer',
      discoveryId: discovered.card.discoveryId,
      nonce: discovered.nonce,
      sessionId: discovered.card.sessionId,
      friendRoomProtocolVersion: 1,
      displayName: input.displayName,
      joinConfirmation: input.joinConfirmation,
    });
    this.datagram.send(encodePacket(packet), discovered.endpoint);
  }

  listNearby(): NearbyFriendCardV1[] {
    return [...this.nearby.values()]
      .map(({ card }) => ({ ...card }))
      .sort((first, second) => first.displayName.localeCompare(second.displayName, 'zh-CN'));
  }

  pruneExpired(): void {
    const nowMs = requireCurrentTime(this.now());
    let changed = false;
    for (const [id, peer] of this.nearby) {
      if (Date.parse(peer.card.expiresAt) <= nowMs) {
        this.nearby.delete(id);
        changed = true;
      }
    }
    if (changed) this.notifyNearby();
  }

  stop(): void {
    if (this.scheduleHandle !== undefined) this.cancelSchedule(this.scheduleHandle);
    this.scheduleHandle = undefined;
    const hadNearby = this.nearby.size > 0;
    this.nearby.clear();
    this.hostOffer = undefined;
    if (this.active) this.datagram.stop();
    this.active = false;
    if (hadNearby) this.notifyNearby();
    this.callbacks = undefined;
  }

  private receive(payload: Buffer, endpoint: LanDatagramEndpointV1): void {
    if (!this.active || payload.length < 1 || payload.length > MAX_PACKET_BYTES) return;
    let packet: LanDiscoveryPacketV1;
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(payload);
      packet = assertLanDiscoveryPacketV1(JSON.parse(source));
    } catch {
      return;
    }
    if (packet.type === 'offer') {
      if (packet.discoveryId === this.hostOffer?.discoveryId) return;
      const nowMs = requireCurrentTime(this.now());
      const expiryMs = Date.parse(packet.expiresAt);
      if (expiryMs <= nowMs || expiryMs - nowMs > MAX_ACCEPTED_FUTURE_MS) return;
      const previous = this.nearby.get(packet.discoveryId);
      const card: NearbyFriendCardV1 = {
        discoveryId: packet.discoveryId,
        sessionId: packet.sessionId,
        displayName: packet.displayName,
        invitationCard: packet.invitationCard,
        expiresAt: packet.expiresAt,
      };
      this.nearby.set(packet.discoveryId, { card, nonce: packet.nonce, endpoint: { ...endpoint } });
      if (!previous || previous.card.displayName !== card.displayName || previous.card.sessionId !== card.sessionId) {
        this.notifyNearby();
      }
      return;
    }
    if (!this.hostOffer
      || packet.discoveryId !== this.hostOffer.discoveryId
      || packet.nonce !== this.hostOffer.nonce
      || packet.sessionId !== this.hostOffer.sessionId) return;
    this.callbacks?.onConfirmation({ displayName: packet.displayName, joinConfirmation: packet.joinConfirmation });
  }

  private broadcastHost(): void {
    if (!this.hostOffer) return;
    const nowMs = requireCurrentTime(this.now());
    this.hostOffer = { ...this.hostOffer, expiresAt: new Date(nowMs + OFFER_LIFETIME_MS).toISOString() };
    this.datagram.broadcast(encodePacket(this.hostOffer));
  }

  private notifyNearby(): void {
    this.callbacks?.onNearbyChanged(this.listNearby());
  }

  private requireActive(): void {
    if (!this.active) throw new Error('请先打开附近好友页面');
  }
}

export interface NodeLanDatagramOptionsV1 {
  port?: number;
  bindAddress?: string;
  broadcastAddress?: string;
}

export class NodeLanDatagramAdapterV1 implements LanDatagramAdapterV1 {
  private socket?: Socket;
  private boundPort = 0;
  private readonly port: number;
  private readonly bindAddress: string;
  private readonly broadcastAddress: string;

  constructor(options: NodeLanDatagramOptionsV1 = {}) {
    this.port = options.port ?? DEFAULT_PORT;
    this.bindAddress = options.bindAddress ?? '0.0.0.0';
    this.broadcastAddress = options.broadcastAddress ?? '255.255.255.255';
  }

  async start(listener: (payload: Buffer, endpoint: LanDatagramEndpointV1) => void): Promise<void> {
    if (this.socket) throw new Error('LAN datagram adapter already started');
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    socket.on('message', (payload, remote) => listener(payload, { address: remote.address, port: remote.port }));
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => { socket.off('listening', ready); reject(error); };
      const ready = () => {
        socket.off('error', fail);
        const address = socket.address();
        this.boundPort = typeof address === 'string' ? this.port : address.port;
        try { socket.setBroadcast(true); } catch { /* Loopback-only environments can still use unicast. */ }
        resolve();
      };
      socket.once('error', fail);
      socket.once('listening', ready);
      socket.bind(this.port, this.bindAddress);
    });
  }

  broadcast(payload: Buffer): void {
    this.requireSocket().send(payload, this.port || this.boundPort, this.broadcastAddress);
  }

  send(payload: Buffer, endpoint: LanDatagramEndpointV1): void {
    this.requireSocket().send(payload, endpoint.port, endpoint.address);
  }

  stop(): void {
    const socket = this.socket;
    this.socket = undefined;
    this.boundPort = 0;
    if (socket) socket.close();
  }

  getPort(): number {
    if (!this.socket || this.boundPort < 1) throw new Error('LAN datagram adapter is not started');
    return this.boundPort;
  }

  private requireSocket(): Socket {
    if (!this.socket) throw new Error('LAN datagram adapter is not started');
    return this.socket;
  }
}

function encodePacket(packet: LanDiscoveryPacketV1): Buffer {
  const payload = Buffer.from(JSON.stringify(packet), 'utf8');
  if (payload.length > MAX_PACKET_BYTES) throw new Error('附近好友邀请过大，请改用异地邀请');
  return payload;
}

function validSignal(value: unknown): string {
  if (typeof value !== 'string'
    || (!value.startsWith('AGFR1.') && !value.startsWith('AGFR2.'))
    || value.length > MAX_SIGNAL_CHARACTERS) throw new Error('附近好友消息结构无效');
  return value;
}

function stableId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64
    || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value)) throw new Error('附近好友消息结构无效');
  return value;
}

function validNonce(value: unknown): string {
  if (typeof value !== 'string' || value.length < 22 || value.length > 64 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('附近好友消息结构无效');
  }
  return value;
}

function validDisplayName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('附近好友消息结构无效');
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 32) throw new Error('附近好友消息结构无效');
  return normalized;
}

function validTime(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new Error('附近好友消息结构无效');
  return value;
}

function requireCurrentTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('系统时间无效');
  return parsed;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
