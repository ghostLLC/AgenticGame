import type {
  FriendRoomBrowserConnectionStateV1,
  FriendRoomRoleV1,
} from '../friend-room/browser-connection-v1.js';
import {
  friendRoomPlayerStatusV1,
  type FriendRoomPlayerStatusV1,
} from './window-contract-v1.js';

export interface FriendRoomEntryConnectionV1 {
  getState(): FriendRoomBrowserConnectionStateV1;
  subscribeState(listener: (state: FriendRoomBrowserConnectionStateV1) => void): () => void;
  createInvite(sessionId: string): Promise<string>;
  acceptInvite(inviteCode: string): Promise<string>;
  acceptAnswer(answerCode: string): Promise<void>;
  dispose(): void;
}

export interface FriendRoomEntrySnapshotV1 {
  role?: FriendRoomRoleV1;
  nickname: string;
  invitationCard?: string;
  joinConfirmation?: string;
  playerStatus: FriendRoomPlayerStatusV1;
}

export interface FriendRoomEntryControllerOptionsV1 {
  createConnection(role: FriendRoomRoleV1): FriendRoomEntryConnectionV1;
  createSessionId(): string;
}

export class FriendRoomEntryControllerV1 {
  private readonly options: FriendRoomEntryControllerOptionsV1;
  private connection: FriendRoomEntryConnectionV1 | undefined;
  private unsubscribeState: (() => void) | undefined;
  private snapshot: FriendRoomEntrySnapshotV1 = {
    nickname: '',
    playerStatus: friendRoomPlayerStatusV1('idle'),
  };
  private readonly listeners = new Set<(snapshot: FriendRoomEntrySnapshotV1) => void>();

  constructor(options: FriendRoomEntryControllerOptionsV1) {
    this.options = options;
  }

  getSnapshot(): FriendRoomEntrySnapshotV1 {
    return { ...this.snapshot };
  }

  subscribe(listener: (snapshot: FriendRoomEntrySnapshotV1) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  async createRoom(nickname: string): Promise<void> {
    const normalizedNickname = validateNickname(nickname);
    const connection = this.startConnection('host', normalizedNickname);
    const invitationCard = await connection.createInvite(this.options.createSessionId());
    this.update({ invitationCard });
  }

  async joinRoom(nickname: string, invitationCard: string): Promise<void> {
    const normalizedNickname = validateNickname(nickname);
    const normalizedInvitation = invitationCard.trim();
    if (!normalizedInvitation) throw new Error('请粘贴好友发来的邀请卡');
    const connection = this.startConnection('guest', normalizedNickname);
    const joinConfirmation = await connection.acceptInvite(normalizedInvitation);
    this.update({ joinConfirmation });
  }

  async confirmFriend(joinConfirmation: string): Promise<void> {
    if (this.snapshot.role !== 'host' || !this.connection) throw new Error('请先创建好友房间');
    const normalizedConfirmation = joinConfirmation.trim();
    if (!normalizedConfirmation) throw new Error('请粘贴朋友发回的加入确认');
    await this.connection.acceptAnswer(normalizedConfirmation);
  }

  reset(): void {
    this.unsubscribeState?.();
    this.unsubscribeState = undefined;
    this.connection?.dispose();
    this.connection = undefined;
    this.snapshot = { nickname: '', playerStatus: friendRoomPlayerStatusV1('idle') };
    this.notify();
  }

  private startConnection(role: FriendRoomRoleV1, nickname: string): FriendRoomEntryConnectionV1 {
    this.reset();
    const connection = this.options.createConnection(role);
    this.connection = connection;
    this.snapshot = { role, nickname, playerStatus: friendRoomPlayerStatusV1(connection.getState()) };
    this.unsubscribeState = connection.subscribeState((state) => {
      this.update({ playerStatus: friendRoomPlayerStatusV1(state) });
    });
    this.notify();
    return connection;
  }

  private update(patch: Partial<FriendRoomEntrySnapshotV1>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

function validateNickname(value: string): string {
  const nickname = value.trim();
  if (!nickname) throw new Error('请先填写你的昵称');
  if (nickname.length > 20) throw new Error('昵称最多 20 个字');
  return nickname;
}
