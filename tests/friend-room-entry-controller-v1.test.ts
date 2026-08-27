import { describe, expect, it } from 'vitest';
import type {
  FriendRoomBrowserConnectionStateV1,
  FriendRoomRoleV1,
} from '../src/friend-room/browser-connection-v1.js';
import {
  FriendRoomEntryControllerV1,
  type FriendRoomEntryConnectionV1,
} from '../src/desktop/friend-room-entry-controller-v1.js';

class FakeEntryConnection implements FriendRoomEntryConnectionV1 {
  private state: FriendRoomBrowserConnectionStateV1 = 'idle';
  private readonly listeners = new Set<(state: FriendRoomBrowserConnectionStateV1) => void>();

  constructor(readonly role: FriendRoomRoleV1) {}

  getState(): FriendRoomBrowserConnectionStateV1 { return this.state; }
  subscribeState(listener: (state: FriendRoomBrowserConnectionStateV1) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  async createInvite(): Promise<string> {
    this.emit('waiting-answer');
    return 'INVITE-CARD';
  }
  async acceptInvite(): Promise<string> {
    this.emit('waiting-host');
    return 'JOIN-CONFIRMATION';
  }
  async acceptAnswer(): Promise<void> { this.emit('connecting'); }
  connect(): void { this.emit('connected'); }
  dispose(): void { this.listeners.clear(); }

  private emit(state: FriendRoomBrowserConnectionStateV1): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}

describe('好友房间玩家入口控制器 v1', () => {
  it('房主只看到邀请卡和加入确认，不接触底层联机术语', async () => {
    let connection: FakeEntryConnection | undefined;
    const controller = new FriendRoomEntryControllerV1({
      createConnection: (role) => (connection = new FakeEntryConnection(role)),
      createSessionId: () => 'friend-room-20260826',
    });

    await controller.createRoom('乐淳');
    expect(connection?.role).toBe('host');
    expect(controller.getSnapshot()).toMatchObject({
      role: 'host',
      nickname: '乐淳',
      invitationCard: 'INVITE-CARD',
      playerStatus: { eyebrow: '邀请卡已生成', title: '等待朋友回应' },
    });

    await controller.confirmFriend('JOIN-CONFIRMATION');
    expect(controller.getSnapshot().playerStatus.title).toBe('正在连接好友');
    connection?.connect();
    expect(controller.getSnapshot().playerStatus.title).toBe('可以进入战前准备');
    expect(JSON.stringify(controller.getSnapshot())).not.toMatch(/WebRTC|offer|answer|STUN|TURN|DataChannel|AGFR/i);
  });

  it('受邀玩家得到可直接发回房主的加入确认', async () => {
    const controller = new FriendRoomEntryControllerV1({
      createConnection: (role) => new FakeEntryConnection(role),
      createSessionId: () => 'unused',
    });

    await controller.joinRoom('Ghost', 'INVITE-CARD');
    expect(controller.getSnapshot()).toMatchObject({
      role: 'guest',
      nickname: 'Ghost',
      joinConfirmation: 'JOIN-CONFIRMATION',
      playerStatus: { eyebrow: '已确认加入', title: '等待房主接收' },
    });
  });

  it('在开始联机前用玩家语言拒绝缺失输入', async () => {
    const controller = new FriendRoomEntryControllerV1({
      createConnection: (role) => new FakeEntryConnection(role),
      createSessionId: () => 'unused',
    });

    await expect(controller.createRoom('  ')).rejects.toThrow('请先填写你的昵称');
    await expect(controller.joinRoom('Ghost', '  ')).rejects.toThrow('请粘贴好友发来的邀请卡');
  });
});
