import { assertSavedBuildV2, type SavedBuildV2 } from '../config/saved-build-v2.js';
import { GAMEPLAY_CONTENT_V2, GAMEPLAY_MAP_FRONTIER_V2 } from '../core/v2/gameplay-content.js';
import { runPracticeMatchV2, type PracticeMatchOutputV2 } from '../practice/run-practice-match-v2.js';
import { verifyMatchBundleV2, type MatchBundleV2 } from '../replay/v2.js';

export interface FriendRoomPeerV1 {
  send(payload: string): void;
  subscribe(listener: (payload: string) => void): () => void;
}

export type FriendRoomSeatV1 = 'host' | 'guest';
export type FriendRoomStatusV1 = 'waiting-for-peer' | 'configuring' | 'running' | 'complete' | 'failed';

export interface FriendRoomPublicBuildV1 {
  buildId: string;
  revision: number;
  createdAt: string;
  label: string;
  loadout: SavedBuildV2['loadout'];
}

export interface FriendRoomParticipantV1 {
  seat: FriendRoomSeatV1;
  displayName: string;
  connected: boolean;
  ready: boolean;
  rematchRequested: boolean;
  build?: FriendRoomPublicBuildV1;
}

export interface FriendRoomResultV1 {
  winningSeats: FriendRoomSeatV1[];
  reason: string;
  ticks: number;
  hp: [number, number];
  violations: [number, number];
  bundleHash: string;
}

export interface FriendRoomSnapshotV1 {
  sessionId: string;
  authority: 'host-device';
  trustModel: 'trusted-friends';
  status: FriendRoomStatusV1;
  revision: number;
  createdAt: string;
  modeId: 'duel';
  mapId: string;
  participants: FriendRoomParticipantV1[];
  result?: FriendRoomResultV1;
  error?: string;
}

export interface FriendRoomProtocolErrorV1 {
  code: 'invalid-message' | 'invalid-build' | 'invalid-state';
  message: string;
}

export interface FriendRoomMatchInputV1 {
  host: SavedBuildV2;
  guest: SavedBuildV2;
  runDefault: () => Promise<PracticeMatchOutputV2>;
}

export interface FriendRoomHostOptionsV1 {
  peer: FriendRoomPeerV1;
  sessionId: string;
  displayName: string;
  createdAt?: () => string;
  maxTicks: number;
  tickBudgetMs?: number;
  runMatch?: (input: FriendRoomMatchInputV1) => Promise<PracticeMatchOutputV2>;
  onBundle?: (bundle: MatchBundleV2) => void | Promise<void>;
}

export interface FriendRoomGuestOptionsV1 {
  peer: FriendRoomPeerV1;
  displayName: string;
}

interface InternalParticipantV1 {
  seat: FriendRoomSeatV1;
  displayName: string;
  connected: boolean;
  ready: boolean;
  rematchRequested: boolean;
  build?: SavedBuildV2;
}

type GuestMessageV1 =
  | { protocol: 'agentic-game-friend-room'; version: 1; type: 'hello'; displayName: string }
  | { protocol: 'agentic-game-friend-room'; version: 1; type: 'select-build'; build: SavedBuildV2 }
  | { protocol: 'agentic-game-friend-room'; version: 1; type: 'set-ready'; ready: boolean }
  | { protocol: 'agentic-game-friend-room'; version: 1; type: 'request-rematch' };

type HostMessageV1 =
  | { protocol: 'agentic-game-friend-room'; version: 1; type: 'snapshot'; snapshot: FriendRoomSnapshotV1 }
  | { protocol: 'agentic-game-friend-room'; version: 1; type: 'error'; error: FriendRoomProtocolErrorV1 };

const PROTOCOL = 'agentic-game-friend-room';

export class FriendRoomHostSessionV1 {
  private readonly options: FriendRoomHostOptionsV1;
  private readonly host: InternalParticipantV1;
  private guest?: InternalParticipantV1;
  private status: FriendRoomStatusV1 = 'waiting-for-peer';
  private revision = 1;
  private readonly createdAt: string;
  private result?: FriendRoomResultV1;
  private error?: string;
  private settlement?: Promise<void>;

  constructor(options: FriendRoomHostOptionsV1) {
    this.options = options;
    this.createdAt = options.createdAt?.() ?? new Date().toISOString();
    this.host = participant('host', options.displayName);
    validateSessionId(options.sessionId);
    if (!Number.isSafeInteger(options.maxTicks) || options.maxTicks < 1) throw new Error('maxTicks must be a positive integer');
    options.peer.subscribe((payload) => this.receive(payload));
  }

  selectBuild(input: unknown): FriendRoomSnapshotV1 {
    this.assertConfigurable();
    this.host.build = cloneRunnableBuild(input);
    this.host.ready = false;
    this.changed();
    return this.getSnapshot();
  }

  setReady(ready: boolean): FriendRoomSnapshotV1 {
    this.assertConfigurable();
    if (ready && !this.host.build) throw new Error('Select a Build before readying');
    this.host.ready = ready;
    this.changed();
    this.startIfReady();
    return this.getSnapshot();
  }

  requestRematch(): FriendRoomSnapshotV1 {
    this.assertComplete();
    this.host.rematchRequested = true;
    this.changed();
    this.restartIfBothWant();
    return this.getSnapshot();
  }

  getSnapshot(): FriendRoomSnapshotV1 {
    const participants = [this.host, this.guest].filter((value): value is InternalParticipantV1 => value !== undefined);
    return {
      sessionId: this.options.sessionId,
      authority: 'host-device',
      trustModel: 'trusted-friends',
      status: this.status,
      revision: this.revision,
      createdAt: this.createdAt,
      modeId: 'duel',
      mapId: GAMEPLAY_MAP_FRONTIER_V2.id,
      participants: participants.map(publicParticipant),
      ...(this.result ? { result: structuredClone(this.result) } : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  async waitForSettlement(): Promise<FriendRoomSnapshotV1> {
    await this.settlement;
    return this.getSnapshot();
  }

  private receive(payload: string): void {
    try {
      const message = parseGuestMessage(payload);
      if (message.type === 'hello') {
        if (this.guest) throw new ProtocolInputError('invalid-state', 'A guest is already connected');
        this.guest = participant('guest', message.displayName);
        this.status = 'configuring';
        this.changed();
        return;
      }
      if (!this.guest) throw new ProtocolInputError('invalid-state', 'Guest hello is required first');
      if (message.type === 'request-rematch') {
        if (this.status !== 'complete') throw new ProtocolInputError('invalid-state', 'The match must finish before a rematch');
        this.guest.rematchRequested = true;
        this.changed();
        this.restartIfBothWant();
        return;
      }
      if (message.type === 'select-build') {
        this.assertConfigurable();
        try {
          this.guest.build = cloneRunnableBuild(message.build);
        } catch {
          throw new ProtocolInputError('invalid-build', 'The selected Build is invalid');
        }
        this.guest.ready = false;
        this.changed();
        return;
      }
      this.assertConfigurable();
      if (message.ready && !this.guest.build) throw new ProtocolInputError('invalid-state', 'Select a Build before readying');
      this.guest.ready = message.ready;
      this.changed();
      this.startIfReady();
    } catch (error) {
      const protocolError = error instanceof ProtocolInputError
        ? { code: error.code, message: error.message }
        : { code: 'invalid-message' as const, message: 'Peer message was rejected' };
      this.send({ protocol: PROTOCOL, version: 1, type: 'error', error: protocolError });
    }
  }

  private changed(): void {
    this.revision += 1;
    this.broadcast();
  }

  private broadcast(): void {
    if (!this.guest) return;
    this.send({ protocol: PROTOCOL, version: 1, type: 'snapshot', snapshot: this.getSnapshot() });
  }

  private send(message: HostMessageV1): void {
    this.options.peer.send(JSON.stringify(message));
  }

  private assertConfigurable(): void {
    if (this.status !== 'waiting-for-peer' && this.status !== 'configuring') {
      throw new Error('Friend room is not configurable');
    }
  }

  private assertComplete(): void {
    if (this.status !== 'complete') throw new Error('Friend room match is not complete');
  }

  private restartIfBothWant(): void {
    if (this.status !== 'complete' || !this.guest || !this.host.rematchRequested || !this.guest.rematchRequested) return;
    this.status = 'configuring';
    this.result = undefined;
    this.error = undefined;
    this.settlement = undefined;
    this.host.ready = false;
    this.guest.ready = false;
    this.host.rematchRequested = false;
    this.guest.rematchRequested = false;
    this.changed();
  }

  private startIfReady(): void {
    if (
      this.status !== 'configuring'
      || !this.guest
      || !this.host.ready
      || !this.guest.ready
      || !this.host.build
      || !this.guest.build
    ) return;
    this.status = 'running';
    this.revision += 1;
    const host = structuredClone(this.host.build);
    const guest = structuredClone(this.guest.build);
    this.broadcast();
    this.settlement = this.run(host, guest);
  }

  private async run(host: SavedBuildV2, guest: SavedBuildV2): Promise<void> {
    try {
      const runDefault = () => runPracticeMatchV2({
        current: host,
        opponent: guest,
        contentSnapshot: GAMEPLAY_CONTENT_V2,
        mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
        seed: 42,
        maxTicks: this.options.maxTicks,
        tickBudgetMs: this.options.tickBudgetMs,
        createdAt: this.options.createdAt?.() ?? new Date().toISOString(),
      });
      const output = await (this.options.runMatch?.({ host, guest, runDefault }) ?? runDefault());
      const verification = verifyMatchBundleV2(output.bundle);
      if (!verification.ok) throw new Error('Friend room produced an invalid bundle');
      await this.options.onBundle?.(output.bundle);
      this.result = {
        winningSeats: output.summary.winningTeamIds.flatMap((teamId) =>
          teamId === 'current' ? ['host' as const] : teamId === 'historical' ? ['guest' as const] : [],
        ),
        reason: output.summary.reason,
        ticks: output.summary.ticks,
        hp: [...output.summary.hp],
        violations: [...output.summary.violations],
        bundleHash: output.bundle.integrity.bundleHash,
      };
      this.status = 'complete';
    } catch {
      this.status = 'failed';
      this.error = '房主设备未能生成有效比赛结果，请重新创建房间。';
    } finally {
      this.revision += 1;
      this.broadcast();
    }
  }
}

export class FriendRoomGuestSessionV1 {
  private readonly peer: FriendRoomPeerV1;
  private snapshot?: FriendRoomSnapshotV1;
  private lastError?: FriendRoomProtocolErrorV1;

  constructor(options: FriendRoomGuestOptionsV1) {
    this.peer = options.peer;
    const displayName = validateDisplayName(options.displayName);
    this.peer.subscribe((payload) => this.receive(payload));
    this.send({ protocol: PROTOCOL, version: 1, type: 'hello', displayName });
  }

  selectBuild(input: unknown): void {
    const selected = cloneRunnableBuild(input);
    this.send({ protocol: PROTOCOL, version: 1, type: 'select-build', build: selected });
  }

  setReady(ready: boolean): void {
    this.send({ protocol: PROTOCOL, version: 1, type: 'set-ready', ready });
  }

  requestRematch(): void {
    this.send({ protocol: PROTOCOL, version: 1, type: 'request-rematch' });
  }

  getSnapshot(): FriendRoomSnapshotV1 {
    if (!this.snapshot) throw new Error('Friend room has not received its first host snapshot');
    return structuredClone(this.snapshot);
  }

  getLastError(): FriendRoomProtocolErrorV1 | undefined {
    return this.lastError ? { ...this.lastError } : undefined;
  }

  private receive(payload: string): void {
    const message = parseHostMessage(payload);
    if (message.type === 'snapshot') this.snapshot = structuredClone(message.snapshot);
    else this.lastError = { ...message.error };
  }

  private send(message: GuestMessageV1): void {
    this.peer.send(JSON.stringify(message));
  }
}

class ProtocolInputError extends Error {
  constructor(readonly code: FriendRoomProtocolErrorV1['code'], message: string) {
    super(message);
  }
}

function parseGuestMessage(payload: string): GuestMessageV1 {
  const value = parseEnvelope(payload);
  if (value.type === 'hello' && typeof value.displayName === 'string') {
    return { protocol: PROTOCOL, version: 1, type: 'hello', displayName: validateDisplayName(value.displayName) };
  }
  if (value.type === 'select-build' && 'build' in value) {
    return { protocol: PROTOCOL, version: 1, type: 'select-build', build: value.build as SavedBuildV2 };
  }
  if (value.type === 'set-ready' && typeof value.ready === 'boolean') {
    return { protocol: PROTOCOL, version: 1, type: 'set-ready', ready: value.ready };
  }
  if (value.type === 'request-rematch') {
    return { protocol: PROTOCOL, version: 1, type: 'request-rematch' };
  }
  throw new ProtocolInputError('invalid-message', 'Guest message type was rejected');
}

function parseHostMessage(payload: string): HostMessageV1 {
  const value = parseEnvelope(payload);
  if (value.type === 'snapshot' && isRecord(value.snapshot)) {
    return { protocol: PROTOCOL, version: 1, type: 'snapshot', snapshot: value.snapshot as unknown as FriendRoomSnapshotV1 };
  }
  if (value.type === 'error' && isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string') {
    return { protocol: PROTOCOL, version: 1, type: 'error', error: value.error as unknown as FriendRoomProtocolErrorV1 };
  }
  throw new Error('Host message type was rejected');
}

function parseEnvelope(payload: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new ProtocolInputError('invalid-message', 'Peer message must be JSON');
  }
  if (!isRecord(value) || value.protocol !== PROTOCOL || value.version !== 1 || typeof value.type !== 'string') {
    throw new ProtocolInputError('invalid-message', 'Peer message has an invalid envelope');
  }
  return value;
}

function participant(seat: FriendRoomSeatV1, displayName: string): InternalParticipantV1 {
  return { seat, displayName: validateDisplayName(displayName), connected: true, ready: false, rematchRequested: false };
}

function publicParticipant(value: InternalParticipantV1): FriendRoomParticipantV1 {
  return {
    seat: value.seat,
    displayName: value.displayName,
    connected: value.connected,
    ready: value.ready,
    rematchRequested: value.rematchRequested,
    ...(value.build ? { build: publicBuild(value.build) } : {}),
  };
}

function publicBuild(value: SavedBuildV2): FriendRoomPublicBuildV1 {
  return {
    buildId: value.buildId,
    revision: value.revision,
    createdAt: value.createdAt,
    label: value.label,
    loadout: structuredClone(value.loadout),
  };
}

function cloneRunnableBuild(input: unknown): SavedBuildV2 {
  const value = structuredClone(assertSavedBuildV2(input));
  if (value.botArtifact.language !== 'javascript') throw new Error('Friend room currently requires JavaScript');
  return value;
}

function validateDisplayName(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 32) throw new Error('Display name must contain 1-32 characters');
  return normalized;
}

function validateSessionId(value: string): void {
  if (!/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value) || value.length > 64) {
    throw new Error('sessionId must be a stable ID');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
