import { describe, expect, it } from 'vitest';
import type {
  FriendDataChannelEventTypeV1,
  FriendDataChannelLikeV1,
} from '../src/friend-room/data-channel-peer-v1.js';
import type {
  FriendSessionDescriptionV1,
  FriendWebRtcPeerConnectionLikeV1,
} from '../src/friend-room/webrtc-handshake-v1.js';
import {
  FriendRoomBrowserConnectionV1,
  createFriendRoomRtcConfigurationV1,
  type FriendBrowserRtcEnvironmentV1,
  type FriendRtcConfigurationV1,
} from '../src/friend-room/browser-connection-v1.js';

class ObservableDataChannel implements FriendDataChannelLikeV1 {
  readyState = 'connecting';
  private readonly listeners = new Map<FriendDataChannelEventTypeV1, Set<(event: { data?: unknown }) => void>>();

  send(): void {}

  addEventListener(type: FriendDataChannelEventTypeV1, listener: (event: { data?: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: FriendDataChannelEventTypeV1, listener: (event: { data?: unknown }) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  open(): void {
    this.readyState = 'open';
    this.emit('open');
  }

  close(): void {
    this.readyState = 'closed';
    this.emit('close');
  }

  private emit(type: FriendDataChannelEventTypeV1): void {
    this.listeners.get(type)?.forEach((listener) => listener({}));
  }
}

class FakePeerConnection implements FriendWebRtcPeerConnectionLikeV1 {
  localDescription: FriendSessionDescriptionV1 | null = null;
  remoteDescription: FriendSessionDescriptionV1 | null = null;
  iceGatheringState: 'new' | 'gathering' | 'complete' = 'complete';
  readonly channel = new ObservableDataChannel();
  private readonly dataChannelListeners = new Set<(event: { channel: FriendDataChannelLikeV1 }) => void>();

  createDataChannel(): FriendDataChannelLikeV1 { return this.channel; }
  async createOffer(): Promise<FriendSessionDescriptionV1> { return { type: 'offer', sdp: 'v=0\r\na=host' }; }
  async createAnswer(): Promise<FriendSessionDescriptionV1> { return { type: 'answer', sdp: 'v=0\r\na=guest' }; }
  async setLocalDescription(value: FriendSessionDescriptionV1): Promise<void> { this.localDescription = value; }
  async setRemoteDescription(value: FriendSessionDescriptionV1): Promise<void> {
    this.remoteDescription = value;
    if (value.type === 'offer') this.dataChannelListeners.forEach((listener) => listener({ channel: this.channel }));
  }
  addEventListener(type: 'icegatheringstatechange' | 'datachannel', listener: (() => void) | ((event: { channel: FriendDataChannelLikeV1 }) => void)): void {
    if (type === 'datachannel') this.dataChannelListeners.add(listener as (event: { channel: FriendDataChannelLikeV1 }) => void);
  }
  removeEventListener(type: 'icegatheringstatechange' | 'datachannel', listener: (() => void) | ((event: { channel: FriendDataChannelLikeV1 }) => void)): void {
    if (type === 'datachannel') this.dataChannelListeners.delete(listener as (event: { channel: FriendDataChannelLikeV1 }) => void);
  }
}

function browserEnvironment(created: Array<{ configuration: FriendRtcConfigurationV1; connection: FakePeerConnection }>): FriendBrowserRtcEnvironmentV1 {
  return {
    RTCPeerConnection: class extends FakePeerConnection {
      constructor(configuration: FriendRtcConfigurationV1) {
        super();
        created.push({ configuration, connection: this });
      }
    },
  };
}

describe('好友房间浏览器 WebRTC 接线 v1', () => {
  it('为直连、STUN 和 TURN 生成明确且受校验的 ICE 配置', () => {
    expect(createFriendRoomRtcConfigurationV1({ mode: 'direct' })).toEqual({ iceServers: [] });
    expect(createFriendRoomRtcConfigurationV1({ mode: 'stun', urls: ['stun:stun.example.com:3478'] })).toEqual({
      iceServers: [{ urls: ['stun:stun.example.com:3478'] }],
    });
    expect(createFriendRoomRtcConfigurationV1({
      mode: 'turn',
      stunUrls: ['stuns:stun.example.com:5349'],
      urls: ['turns:turn.example.com:5349'],
      username: 'friend',
      credential: 'secret',
    })).toEqual({
      iceServers: [
        { urls: ['stuns:stun.example.com:5349'] },
        { urls: ['turns:turn.example.com:5349'], username: 'friend', credential: 'secret' },
      ],
    });
    expect(() => createFriendRoomRtcConfigurationV1({ mode: 'stun', urls: ['https://example.com'] }))
      .toThrow('Invalid STUN URL');
    expect(() => createFriendRoomRtcConfigurationV1({
      mode: 'turn', urls: ['turn:turn.example.com'], username: '', credential: '',
    })).toThrow('TURN username and credential are required');
  });

  it('驱动房主和客人的真实浏览器握手状态，DataChannel 开关决定连接状态', async () => {
    const hostCreated: Array<{ configuration: FriendRtcConfigurationV1; connection: FakePeerConnection }> = [];
    const guestCreated: Array<{ configuration: FriendRtcConfigurationV1; connection: FakePeerConnection }> = [];
    const host = new FriendRoomBrowserConnectionV1({
      role: 'host', browser: browserEnvironment(hostCreated), ice: { mode: 'direct' },
    });
    const guest = new FriendRoomBrowserConnectionV1({
      role: 'guest', browser: browserEnvironment(guestCreated), ice: { mode: 'direct' },
    });

    const invite = await host.createInvite('friend-session-6');
    expect(host.getState()).toBe('waiting-answer');
    const answer = await guest.acceptInvite(invite);
    expect(guest.getState()).toBe('waiting-host');
    await host.acceptAnswer(answer);
    expect(host.getState()).toBe('connecting');

    hostCreated[0]!.connection.channel.open();
    guestCreated[0]!.connection.channel.open();
    expect(host.getState()).toBe('connected');
    expect(guest.getState()).toBe('connected');
    expect(host.getPeer()).toBeDefined();
    expect(guest.getPeer()).toBeDefined();

    hostCreated[0]!.connection.channel.close();
    expect(host.getState()).toBe('disconnected');
    expect(hostCreated[0]!.configuration).toEqual({ iceServers: [] });
  });

  it('在浏览器不支持 WebRTC 或角色调用错误时快速失败', async () => {
    expect(() => new FriendRoomBrowserConnectionV1({
      role: 'host', browser: {}, ice: { mode: 'direct' },
    })).toThrow('WebRTC is not available');

    const created: Array<{ configuration: FriendRtcConfigurationV1; connection: FakePeerConnection }> = [];
    const guest = new FriendRoomBrowserConnectionV1({
      role: 'guest', browser: browserEnvironment(created), ice: { mode: 'direct' },
    });
    await expect(guest.createInvite('friend-session-7')).rejects.toThrow('Only the host can create an invite');
    expect(guest.getState()).toBe('failed');
  });
});
