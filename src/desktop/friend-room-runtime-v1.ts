import { createHash } from 'node:crypto';
import {
  FriendRoomGuestSessionV1,
  FriendRoomHostSessionV1,
  type FriendRoomPeerV1,
  type FriendRoomSnapshotV1,
} from '../friend-room/session-v1.js';
import type { FriendRoomRoleV1 } from '../friend-room/browser-connection-v1.js';
import {
  createPresetBuildV1,
  friendRoomPresetOptionsV1,
  type FriendRoomPresetIdV1,
} from './preset-builds-v1.js';
import type { FriendRoomReplayV1 } from '../friend-room/replay-v1.js';
import type { SavedBuildV2 } from '../config/saved-build-v2.js';
import type { FriendRoomRecoveryCapsuleV1 } from './friend-room-recovery-store-v1.js';

export {
  friendRoomPresetOptionsV1,
  type FriendRoomPresetIdV1,
  type FriendRoomPresetOptionV1,
} from './preset-builds-v1.js';

export interface DesktopFriendRoomEventV1 {
  kind: 'snapshot' | 'error';
  snapshot?: FriendRoomSnapshotV1;
  message?: string;
}

export interface DesktopFriendRoomRuntimeOptionsV1 {
  sendPeer(payload: string): void;
  onEvent(event: DesktopFriendRoomEventV1): void;
  createdAt?: () => string;
  maxTicks?: number;
  onPublicReplay?(input: {
    replay: FriendRoomReplayV1;
    createdAt: string;
    localTeamId: string;
    completionKey: string;
  }): void | Promise<void>;
  onRecovery?(capsule: FriendRoomRecoveryCapsuleV1 | undefined): void | Promise<void>;
}

export interface DesktopFriendRoomStartV1 {
  role: FriendRoomRoleV1;
  displayName: string;
  sessionId?: string;
}

export class DesktopFriendRoomRuntimeV1 {
  private readonly options: DesktopFriendRoomRuntimeOptionsV1;
  private readonly peerListeners = new Set<(payload: string) => void>();
  private readonly peer: FriendRoomPeerV1;
  private host?: FriendRoomHostSessionV1;
  private guest?: FriendRoomGuestSessionV1;
  private role?: FriendRoomRoleV1;
  private settlement?: Promise<void>;
  private persistence?: Promise<void>;
  private readonly persistedCompletions = new Set<string>();
  private previousStatus?: FriendRoomSnapshotV1['status'];
  private displayName?: string;
  private sessionId?: string;
  private ownBuild?: SavedBuildV2;
  private recoverySessionId?: string;
  private recoveryRevision?: number;

  constructor(options: DesktopFriendRoomRuntimeOptionsV1) {
    this.options = options;
    this.peer = {
      send: (payload) => options.sendPeer(payload),
      subscribe: (listener) => {
        this.peerListeners.add(listener);
        return () => this.peerListeners.delete(listener);
      },
    };
  }

  start(input: DesktopFriendRoomStartV1): void {
    if (this.role) throw new Error('好友房间已经开始');
    this.role = input.role;
    this.displayName = input.displayName;
    this.sessionId = input.sessionId;
    if (input.role === 'host') {
      if (!input.sessionId) throw new Error('房主缺少房间编号');
      this.host = new FriendRoomHostSessionV1({
        peer: this.peer,
        sessionId: input.sessionId,
        displayName: input.displayName,
        createdAt: this.options.createdAt,
        maxTicks: this.options.maxTicks ?? 120,
        tickBudgetMs: 100,
      });
      this.emitSnapshot(this.host.getSnapshot());
      return;
    }
    this.guest = new FriendRoomGuestSessionV1({ peer: this.peer, displayName: input.displayName });
  }

  restore(capsule: FriendRoomRecoveryCapsuleV1): void {
    if (this.role) throw new Error('好友房间已经开始');
    this.role = capsule.role;
    this.displayName = capsule.displayName;
    this.sessionId = capsule.sessionId;
    this.recoverySessionId = capsule.sessionId;
    this.recoveryRevision = capsule.revision;
    this.ownBuild = capsule.ownBuild ? structuredClone(capsule.ownBuild) : undefined;
    if (capsule.role === 'host') {
      this.host = new FriendRoomHostSessionV1({
        peer: this.peer,
        sessionId: capsule.sessionId,
        displayName: capsule.displayName,
        createdAt: this.options.createdAt,
        maxTicks: this.options.maxTicks ?? 120,
        tickBudgetMs: 100,
        recovery: {
          revision: capsule.revision,
          createdAt: capsule.createdAt,
          ...(capsule.ownBuild ? { ownBuild: capsule.ownBuild } : {}),
        },
      });
      this.emitSnapshot(this.host.getSnapshot());
      return;
    }
    this.guest = new FriendRoomGuestSessionV1({ peer: this.peer, displayName: capsule.displayName });
    if (this.ownBuild) this.guest.selectBuild(this.ownBuild);
  }

  receivePeer(payload: string): void {
    try {
      this.peerListeners.forEach((listener) => listener(payload));
      this.emitCurrentSnapshot();
      this.trackSettlement();
    } catch {
      this.options.onEvent({ kind: 'error', message: '好友房间收到的内容无效，请重新创建房间。' });
    }
  }

  selectPreset(presetId: FriendRoomPresetIdV1): void {
    const build = createPresetBuildV1(presetId, this.options.createdAt?.() ?? new Date().toISOString());
    this.ownBuild = structuredClone(build);
    if (this.host) this.host.selectBuild(build);
    else if (this.guest) this.guest.selectBuild(build);
    else throw new Error('请先连接好友');
    this.emitCurrentSnapshot();
  }

  setReady(ready: boolean): void {
    if (this.host) this.host.setReady(ready);
    else if (this.guest) this.guest.setReady(ready);
    else throw new Error('请先连接好友');
    this.emitCurrentSnapshot();
    this.trackSettlement();
  }

  requestRematch(): void {
    if (this.host) this.host.requestRematch();
    else if (this.guest) this.guest.requestRematch();
    else throw new Error('请先连接好友');
    this.emitCurrentSnapshot();
  }

  closeRoom(): void {
    if (this.host) this.emitSnapshot(this.host.close());
    else this.notifyRecovery(undefined);
  }

  transportClosed(): void {
    if (this.host) this.emitSnapshot(this.host.markPeerDisconnected());
  }

  resumeTransport(): void {
    if (this.guest) this.guest.resume();
    this.emitCurrentSnapshot();
  }

  async waitForSettlement(): Promise<void> {
    this.trackSettlement();
    await this.settlement;
    await this.persistence;
  }

  async waitForPersistence(): Promise<void> {
    await this.persistence;
  }

  private emitCurrentSnapshot(): void {
    if (this.host) this.emitSnapshot(this.host.getSnapshot());
    else if (this.guest) {
      try {
        this.emitSnapshot(this.guest.getSnapshot());
      } catch {
        // The guest receives its first snapshot immediately after the host accepts hello.
      }
    }
  }

  private emitSnapshot(snapshot: FriendRoomSnapshotV1): void {
    if (this.recoverySessionId && snapshot.sessionId !== this.recoverySessionId) {
      this.options.onEvent({ kind: 'error', message: '这不是原好友房间，请重新会合。' });
      return;
    }
    if (this.role === 'guest' && this.recoveryRevision && snapshot.revision < this.recoveryRevision) {
      this.options.onEvent({ kind: 'error', message: '房间状态早于本机记录，请让房主重新生成会合邀请。' });
      return;
    }
    if (snapshot.status === 'configuring') this.settlement = undefined;
    this.options.onEvent({ kind: 'snapshot', snapshot });
    if (snapshot.status === 'closed') this.notifyRecovery(undefined);
    else this.notifyRecovery(this.createRecoveryCapsule(snapshot));
    const enteredComplete = snapshot.status === 'complete' && this.previousStatus !== 'complete';
    this.previousStatus = snapshot.status;
    if (enteredComplete) this.persistPublicReplay(snapshot);
  }

  private createRecoveryCapsule(snapshot: FriendRoomSnapshotV1): FriendRoomRecoveryCapsuleV1 | undefined {
    if (!this.role || !this.displayName) return undefined;
    const createdAtMs = Date.parse(snapshot.createdAt);
    if (!Number.isFinite(createdAtMs)) return undefined;
    return {
      version: 1,
      role: this.role,
      sessionId: snapshot.sessionId,
      displayName: this.displayName,
      revision: snapshot.revision,
      createdAt: snapshot.createdAt,
      expiresAt: new Date(createdAtMs + 24 * 60 * 60 * 1000).toISOString(),
      ...(this.ownBuild ? { ownBuild: structuredClone(this.ownBuild) } : {}),
      publicSnapshot: {
        status: snapshot.status,
        mapId: snapshot.mapId,
        participants: snapshot.participants.map((participant) => ({
          seat: participant.seat,
          displayName: participant.displayName,
          connected: participant.connected,
          ready: participant.ready,
        })),
      },
    };
  }

  private notifyRecovery(capsule: FriendRoomRecoveryCapsuleV1 | undefined): void {
    if (!this.options.onRecovery) return;
    Promise.resolve(this.options.onRecovery(capsule)).catch(() => {
      this.options.onEvent({ kind: 'error', message: '房间恢复信息未能安全保存。' });
    });
  }

  private persistPublicReplay(snapshot: FriendRoomSnapshotV1): void {
    if (snapshot.status !== 'complete' || !snapshot.replay || !this.role || !this.options.onPublicReplay) return;
    const identity = `${snapshot.sessionId}:${snapshot.revision}`;
    if (this.persistedCompletions.has(identity)) return;
    this.persistedCompletions.add(identity);
    const completionKey = createHash('sha256').update(identity, 'utf8').digest('hex');
    const localTeamId = this.role === 'host' ? 'current' : 'historical';
    this.persistence = Promise.resolve(this.options.onPublicReplay({
      replay: structuredClone(snapshot.replay),
      createdAt: snapshot.createdAt,
      localTeamId,
      completionKey,
    })).catch(() => {
      this.options.onEvent({ kind: 'error', message: '比赛已经结束，但回放未能保存。' });
    });
  }

  private trackSettlement(): void {
    if (!this.host || this.host.getSnapshot().status !== 'running' || this.settlement) return;
    this.settlement = this.host.waitForSettlement().then((snapshot) => this.emitSnapshot(snapshot));
  }
}
