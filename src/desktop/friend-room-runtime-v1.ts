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
    if (snapshot.status === 'configuring') this.settlement = undefined;
    this.options.onEvent({ kind: 'snapshot', snapshot });
  }

  private trackSettlement(): void {
    if (!this.host || this.host.getSnapshot().status !== 'running' || this.settlement) return;
    this.settlement = this.host.waitForSettlement().then((snapshot) => this.emitSnapshot(snapshot));
  }
}
