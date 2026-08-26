/**
 * @deprecated Frozen cloud-authoritative prototype for a future ranked mode.
 * Friend rooms use src/friend-room and must not depend on this service.
 */
import { randomBytes } from 'node:crypto';
import { assertSavedBuildV2, type SavedBuildV2 } from '../config/saved-build-v2.js';
import { GAMEPLAY_CONTENT_V2, GAMEPLAY_MAP_FRONTIER_V2 } from '../core/v2/gameplay-content.js';
import { runPracticeMatchV2, type PracticeMatchOutputV2 } from '../practice/run-practice-match-v2.js';
import { verifyMatchBundleV2, type MatchBundleV2 } from '../replay/v2.js';

export type AsyncRoomSeatV1 = 'host' | 'challenger';
export type AsyncRoomStatusV1 = 'waiting-for-opponent' | 'configuring' | 'running' | 'complete' | 'failed';

export interface AsyncRoomPublicBuildV1 {
  buildId: string;
  revision: number;
  createdAt: string;
  label: string;
  loadout: SavedBuildV2['loadout'];
}

export interface AsyncRoomParticipantV1 {
  seat: AsyncRoomSeatV1;
  displayName: string;
  ready: boolean;
  build?: AsyncRoomPublicBuildV1;
}

export interface AsyncRoomResultV1 {
  winningSeats: AsyncRoomSeatV1[];
  reason: string;
  ticks: number;
  hp: [number, number];
  violations: [number, number];
  bundleHash: string;
}

export interface AsyncRoomSnapshotV1 {
  code: string;
  status: AsyncRoomStatusV1;
  revision: number;
  createdAt: string;
  modeId: 'duel';
  mapId: string;
  participants: AsyncRoomParticipantV1[];
  result?: AsyncRoomResultV1;
  error?: string;
}

export interface AsyncRoomAccessV1 {
  participantToken: string;
  room: AsyncRoomSnapshotV1;
}

export interface AsyncRoomMatchInputV1 {
  host: SavedBuildV2;
  challenger: SavedBuildV2;
  runDefault: () => Promise<PracticeMatchOutputV2>;
}

export interface AsyncRoomServiceOptionsV1 {
  roomCode?: () => string;
  participantToken?: (seat: AsyncRoomSeatV1) => string;
  createdAt?: () => string;
  maxTicks?: number;
  tickBudgetMs?: number;
  runMatch?: (input: AsyncRoomMatchInputV1) => Promise<PracticeMatchOutputV2>;
  onBundle?: (bundle: MatchBundleV2) => void | Promise<void>;
}

interface InternalParticipantV1 {
  seat: AsyncRoomSeatV1;
  displayName: string;
  token: string;
  ready: boolean;
  build?: SavedBuildV2;
}

interface InternalRoomV1 {
  code: string;
  status: AsyncRoomStatusV1;
  revision: number;
  createdAt: string;
  host: InternalParticipantV1;
  challenger?: InternalParticipantV1;
  result?: AsyncRoomResultV1;
  error?: string;
  settlement?: Promise<void>;
}

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class AsyncRoomServiceV1 {
  private readonly rooms = new Map<string, InternalRoomV1>();
  private readonly options: AsyncRoomServiceOptionsV1;

  constructor(options: AsyncRoomServiceOptionsV1 = {}) {
    this.options = options;
  }

  createRoom(displayName: string): AsyncRoomAccessV1 {
    const code = this.createUniqueCode();
    const room: InternalRoomV1 = {
      code,
      status: 'waiting-for-opponent',
      revision: 1,
      createdAt: this.options.createdAt?.() ?? new Date().toISOString(),
      host: this.participant('host', displayName),
    };
    this.rooms.set(code, room);
    return { participantToken: room.host.token, room: snapshot(room) };
  }

  joinRoom(roomCode: string, displayName: string): AsyncRoomAccessV1 {
    const room = this.room(roomCode);
    if (room.challenger) throw new Error('Room is full');
    if (room.status !== 'waiting-for-opponent') throw new Error('Room is not joinable');
    room.challenger = this.participant('challenger', displayName);
    room.status = 'configuring';
    room.revision += 1;
    return { participantToken: room.challenger.token, room: snapshot(room) };
  }

  getRoom(roomCode: string, participantToken: string): AsyncRoomSnapshotV1 {
    const room = this.room(roomCode);
    this.authorize(room, participantToken);
    return snapshot(room);
  }

  selectBuild(roomCode: string, participantToken: string, input: unknown): AsyncRoomSnapshotV1 {
    const room = this.room(roomCode);
    if (room.status !== 'waiting-for-opponent' && room.status !== 'configuring') {
      throw new Error('Room is not configurable');
    }
    const participant = this.authorize(room, participantToken);
    const build = structuredClone(assertSavedBuildV2(input));
    if (build.botArtifact.language !== 'javascript') throw new Error('Room match currently requires JavaScript');
    participant.build = build;
    participant.ready = false;
    room.revision += 1;
    return snapshot(room);
  }

  setReady(roomCode: string, participantToken: string, ready: boolean): AsyncRoomSnapshotV1 {
    const room = this.room(roomCode);
    if (room.status !== 'configuring') throw new Error('Room is not configurable');
    const participant = this.authorize(room, participantToken);
    if (ready && !participant.build) throw new Error('Select a Build before readying');
    participant.ready = ready;
    room.revision += 1;
    if (room.host.ready && room.challenger?.ready) this.start(room);
    return snapshot(room);
  }

  async waitForSettlement(roomCode: string, participantToken: string): Promise<AsyncRoomSnapshotV1> {
    const room = this.room(roomCode);
    this.authorize(room, participantToken);
    await room.settlement;
    return snapshot(room);
  }

  private start(room: InternalRoomV1): void {
    if (room.status !== 'configuring' || !room.challenger || !room.host.build || !room.challenger.build) return;
    room.status = 'running';
    room.revision += 1;
    const host = structuredClone(room.host.build);
    const challenger = structuredClone(room.challenger.build);
    room.settlement = this.run(room, host, challenger);
  }

  private async run(room: InternalRoomV1, host: SavedBuildV2, challenger: SavedBuildV2): Promise<void> {
    try {
      const runDefault = () => runPracticeMatchV2({
        current: host,
        opponent: challenger,
        contentSnapshot: GAMEPLAY_CONTENT_V2,
        mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
        seed: 42,
        maxTicks: this.options.maxTicks ?? 1500,
        tickBudgetMs: this.options.tickBudgetMs,
        createdAt: this.options.createdAt?.() ?? new Date().toISOString(),
      });
      const output = await (this.options.runMatch?.({ host, challenger, runDefault }) ?? runDefault());
      const verification = verifyMatchBundleV2(output.bundle);
      if (!verification.ok) throw new Error('Room match produced an invalid bundle');
      await this.options.onBundle?.(output.bundle);
      room.result = {
        winningSeats: output.summary.winningTeamIds.flatMap((teamId) =>
          teamId === 'current' ? ['host' as const] : teamId === 'historical' ? ['challenger' as const] : [],
        ),
        reason: output.summary.reason,
        ticks: output.summary.ticks,
        hp: [...output.summary.hp],
        violations: [...output.summary.violations],
        bundleHash: output.bundle.integrity.bundleHash,
      };
      room.status = 'complete';
    } catch (error) {
      room.status = 'failed';
      room.error = publicError(error);
    } finally {
      room.revision += 1;
    }
  }

  private participant(seat: AsyncRoomSeatV1, displayName: string): InternalParticipantV1 {
    const normalized = validateDisplayName(displayName);
    return {
      seat,
      displayName: normalized,
      token: this.options.participantToken?.(seat) ?? randomBytes(32).toString('hex'),
      ready: false,
    };
  }

  private authorize(room: InternalRoomV1, token: string): InternalParticipantV1 {
    if (room.host.token === token) return room.host;
    if (room.challenger?.token === token) return room.challenger;
    throw new Error('Invalid participant token');
  }

  private room(roomCode: string): InternalRoomV1 {
    const code = normalizeCode(roomCode);
    const room = this.rooms.get(code);
    if (!room) throw new Error('Room not found');
    return room;
  }

  private createUniqueCode(): string {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate = normalizeCode(this.options.roomCode?.() ?? randomCode());
      if (!this.rooms.has(candidate)) return candidate;
    }
    throw new Error('Unable to allocate a unique room code');
  }
}

function snapshot(room: InternalRoomV1): AsyncRoomSnapshotV1 {
  const participants = [room.host, room.challenger].filter((item): item is InternalParticipantV1 => item !== undefined);
  return {
    code: room.code,
    status: room.status,
    revision: room.revision,
    createdAt: room.createdAt,
    modeId: 'duel',
    mapId: GAMEPLAY_MAP_FRONTIER_V2.id,
    participants: participants.map((participant) => ({
      seat: participant.seat,
      displayName: participant.displayName,
      ready: participant.ready,
      ...(participant.build ? { build: publicBuild(participant.build) } : {}),
    })),
    ...(room.result ? { result: structuredClone(room.result) } : {}),
    ...(room.error ? { error: room.error } : {}),
  };
}

function publicBuild(build: SavedBuildV2): AsyncRoomPublicBuildV1 {
  return {
    buildId: build.buildId,
    revision: build.revision,
    createdAt: build.createdAt,
    label: build.label,
    loadout: structuredClone(build.loadout),
  };
}

function validateDisplayName(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 32) throw new Error('Display name must contain 1-32 characters');
  return normalized;
}

function normalizeCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!ROOM_CODE.test(normalized)) throw new Error('Invalid room code');
  return normalized;
}

function randomCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('');
}

function publicError(error: unknown): string {
  if (error instanceof Error && /load|timeout|violation|invalid bundle/i.test(error.message)) {
    return '比赛未能生成有效结果，请重新创建房间。';
  }
  return '比赛服务暂时不可用，请重新创建房间。';
}
