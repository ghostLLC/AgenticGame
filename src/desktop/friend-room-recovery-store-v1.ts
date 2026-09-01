import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSavedBuildV2, type SavedBuildV2 } from '../config/saved-build-v2.js';
import type { FriendRoomRoleV1 } from '../friend-room/browser-connection-v1.js';
import type { FriendRoomSeatV1, FriendRoomStatusV1 } from '../friend-room/session-v1.js';

const FILE_MAGIC = Buffer.from('AGFRREC1', 'utf8');
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const RECOVERY_FILE = 'active-room-v1.room';

export interface FriendRoomRecoveryCipherV1 {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export interface FriendRoomRecoveryParticipantV1 {
  seat: FriendRoomSeatV1;
  displayName: string;
  connected: boolean;
  ready: boolean;
}

export interface FriendRoomRecoveryPublicSnapshotV1 {
  status: FriendRoomStatusV1;
  mapId: string;
  participants: FriendRoomRecoveryParticipantV1[];
}

export interface FriendRoomRecoveryCapsuleV1 {
  version: 1;
  role: FriendRoomRoleV1;
  sessionId: string;
  displayName: string;
  revision: number;
  createdAt: string;
  expiresAt: string;
  ownBuild?: SavedBuildV2;
  publicSnapshot: FriendRoomRecoveryPublicSnapshotV1;
}

export type FriendRoomRecoveryInspectionV1 =
  | { status: 'available'; capsule: FriendRoomRecoveryCapsuleV1 }
  | { status: 'missing' | 'disabled' | 'expired' | 'invalid' };

export interface FriendRoomRecoveryStoreOptionsV1 {
  now?: () => string;
}

export function assertFriendRoomRecoveryCapsuleV1(input: unknown): FriendRoomRecoveryCapsuleV1 {
  if (!isRecord(input) || !hasExactKeys(input, [
    'version', 'role', 'sessionId', 'displayName', 'revision', 'createdAt', 'expiresAt', 'publicSnapshot',
  ], ['ownBuild'])) throw new Error('恢复胶囊结构无效');
  if (input.version !== 1 || (input.role !== 'host' && input.role !== 'guest')) throw new Error('恢复胶囊结构无效');
  const sessionId = requireStableId(input.sessionId);
  const displayName = requireDisplayName(input.displayName);
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 1) throw new Error('恢复胶囊结构无效');
  const createdAtMs = parseTime(input.createdAt);
  const expiresAtMs = parseTime(input.expiresAt);
  if (createdAtMs === undefined || expiresAtMs === undefined || expiresAtMs <= createdAtMs) {
    throw new Error('恢复胶囊时间无效');
  }
  if (expiresAtMs - createdAtMs > MAX_DURATION_MS) throw new Error('恢复胶囊有效期不能超过 24 小时');
  const publicSnapshot = assertPublicSnapshot(input.publicSnapshot);
  const ownBuild = input.ownBuild === undefined ? undefined : structuredClone(assertSavedBuildV2(input.ownBuild));
  return {
    version: 1,
    role: input.role,
    sessionId,
    displayName,
    revision: input.revision as number,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    ...(ownBuild ? { ownBuild } : {}),
    publicSnapshot,
  };
}

export class FriendRoomRecoveryStoreV1 {
  private readonly recoveryDirectory: string;
  private readonly recoveryPath: string;
  private readonly now: () => string;

  constructor(
    root: string,
    private readonly cipher: FriendRoomRecoveryCipherV1,
    options: FriendRoomRecoveryStoreOptionsV1 = {},
  ) {
    this.recoveryDirectory = join(root, 'rooms');
    this.recoveryPath = join(this.recoveryDirectory, RECOVERY_FILE);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async save(input: FriendRoomRecoveryCapsuleV1): Promise<{ status: 'saved' | 'disabled' }> {
    if (!this.cipher.isAvailable()) return { status: 'disabled' };
    const capsule = assertFriendRoomRecoveryCapsuleV1(input);
    const encrypted = this.cipher.encrypt(JSON.stringify(capsule));
    if (!Buffer.isBuffer(encrypted) || encrypted.length < 1) throw new Error('系统加密未能保存房间恢复信息');
    await mkdir(this.recoveryDirectory, { recursive: true });
    const temporaryPath = join(this.recoveryDirectory, `${RECOVERY_FILE}.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, 'wx');
    try {
      await handle.writeFile(Buffer.concat([FILE_MAGIC, encrypted]));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, this.recoveryPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    return { status: 'saved' };
  }

  async inspect(): Promise<FriendRoomRecoveryInspectionV1> {
    if (!this.cipher.isAvailable()) return { status: 'disabled' };
    let source: Buffer;
    try {
      source = await readFile(this.recoveryPath);
    } catch (error) {
      if (isMissing(error)) return { status: 'missing' };
      throw error;
    }
    try {
      if (source.length <= FILE_MAGIC.length || !source.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
        throw new Error('invalid recovery envelope');
      }
      const decrypted = this.cipher.decrypt(source.subarray(FILE_MAGIC.length));
      const capsule = assertFriendRoomRecoveryCapsuleV1(JSON.parse(decrypted));
      const nowMs = parseTime(this.now());
      if (nowMs === undefined) throw new Error('invalid clock');
      if (Date.parse(capsule.expiresAt) <= nowMs) {
        await this.clear();
        return { status: 'expired' };
      }
      return { status: 'available', capsule };
    } catch {
      await this.clear();
      return { status: 'invalid' };
    }
  }

  async clear(): Promise<void> {
    await rm(this.recoveryPath, { force: true });
  }
}

function assertPublicSnapshot(input: unknown): FriendRoomRecoveryPublicSnapshotV1 {
  if (!isRecord(input) || !hasExactKeys(input, ['status', 'mapId', 'participants'])) {
    throw new Error('恢复胶囊结构无效');
  }
  if (!['waiting-for-peer', 'configuring', 'running', 'complete', 'failed'].includes(String(input.status))) {
    throw new Error('恢复胶囊结构无效');
  }
  if (typeof input.mapId !== 'string' || input.mapId.length < 1 || input.mapId.length > 64) {
    throw new Error('恢复胶囊结构无效');
  }
  if (!Array.isArray(input.participants) || input.participants.length < 1 || input.participants.length > 2) {
    throw new Error('恢复胶囊结构无效');
  }
  const participants = input.participants.map((participant) => {
    if (!isRecord(participant) || !hasExactKeys(participant, ['seat', 'displayName', 'connected', 'ready'])) {
      throw new Error('恢复胶囊结构无效');
    }
    if ((participant.seat !== 'host' && participant.seat !== 'guest')
      || typeof participant.connected !== 'boolean' || typeof participant.ready !== 'boolean') {
      throw new Error('恢复胶囊结构无效');
    }
    return {
      seat: participant.seat as FriendRoomSeatV1,
      displayName: requireDisplayName(participant.displayName),
      connected: participant.connected,
      ready: participant.ready,
    };
  });
  if (new Set(participants.map((participant) => participant.seat)).size !== participants.length) {
    throw new Error('恢复胶囊结构无效');
  }
  return {
    status: input.status as FriendRoomStatusV1,
    mapId: input.mapId,
    participants,
  };
}

function requireStableId(input: unknown): string {
  if (typeof input !== 'string' || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(input) || input.length > 64) {
    throw new Error('恢复胶囊结构无效');
  }
  return input;
}

function requireDisplayName(input: unknown): string {
  if (typeof input !== 'string') throw new Error('恢复胶囊结构无效');
  const normalized = input.trim();
  if (normalized.length < 1 || normalized.length > 32) throw new Error('恢复胶囊结构无效');
  return normalized;
}

function parseTime(input: unknown): number | undefined {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input)) return undefined;
  const value = Date.parse(input);
  return Number.isFinite(value) ? value : undefined;
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value).sort();
  const allowed = [...required, ...optional];
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
