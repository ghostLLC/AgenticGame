import { describe, expect, it } from 'vitest';
import type { FriendDataChannelLikeV1 } from '../src/friend-room/data-channel-peer-v1.js';
import {
  acceptFriendRoomHostAnswerV1,
  createFriendRoomGuestAnswerV1,
  createFriendRoomHostOfferV1,
  decodeFriendRoomSignal,
  decodeFriendRoomSignalV1,
  encodeFriendRoomSignalV1,
  encodeFriendRoomSignalV2,
  type FriendSessionDescriptionV1,
  type FriendWebRtcPeerConnectionLikeV1,
} from '../src/friend-room/webrtc-handshake-v1.js';

class SilentDataChannel implements FriendDataChannelLikeV1 {
  readonly readyState = 'open';
  readonly sent: string[] = [];
  send(data: string): void { this.sent.push(data); }
  addEventListener(): void {}
  removeEventListener(): void {}
}

class FakePeerConnection implements FriendWebRtcPeerConnectionLikeV1 {
  localDescription: FriendSessionDescriptionV1 | null = null;
  remoteDescription: FriendSessionDescriptionV1 | null = null;
  iceGatheringState: 'new' | 'gathering' | 'complete' = 'complete';
  readonly channel = new SilentDataChannel();
  readonly labels: string[] = [];
  private readonly dataChannelListeners = new Set<(event: { channel: FriendDataChannelLikeV1 }) => void>();
  private readonly iceListeners = new Set<() => void>();

  createDataChannel(label: string): FriendDataChannelLikeV1 {
    this.labels.push(label);
    return this.channel;
  }

  async createOffer(): Promise<FriendSessionDescriptionV1> {
    return { type: 'offer', sdp: 'v=0\r\na=host-offer' };
  }

  async createAnswer(): Promise<FriendSessionDescriptionV1> {
    return { type: 'answer', sdp: 'v=0\r\na=guest-answer' };
  }

  async setLocalDescription(description: FriendSessionDescriptionV1): Promise<void> {
    this.localDescription = description;
  }

  async setRemoteDescription(description: FriendSessionDescriptionV1): Promise<void> {
    this.remoteDescription = description;
    if (description.type === 'offer') {
      this.dataChannelListeners.forEach((listener) => listener({ channel: this.channel }));
    }
  }

  addEventListener(type: 'icegatheringstatechange' | 'datachannel', listener: (() => void) | ((event: { channel: FriendDataChannelLikeV1 }) => void)): void {
    if (type === 'icegatheringstatechange') this.iceListeners.add(listener as () => void);
    else this.dataChannelListeners.add(listener as (event: { channel: FriendDataChannelLikeV1 }) => void);
  }

  removeEventListener(type: 'icegatheringstatechange' | 'datachannel', listener: (() => void) | ((event: { channel: FriendDataChannelLikeV1 }) => void)): void {
    if (type === 'icegatheringstatechange') this.iceListeners.delete(listener as () => void);
    else this.dataChannelListeners.delete(listener as (event: { channel: FriendDataChannelLikeV1 }) => void);
  }
}

describe('好友房间 WebRTC 手动信令 v1', () => {
  it('把真实长度的邀请压缩为适合聊天分享的 v2 邀请卡，并兼容旧邀请', async () => {
    const candidate = 'a=candidate:860182107 1 udp 1677729535 203.0.113.7 40285 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999\r\n';
    const signal = {
      protocol: 'agentic-game-friend-signal' as const,
      version: 1 as const,
      sessionId: 'friend-compressed-1',
      kind: 'offer' as const,
      description: { type: 'offer' as const, sdp: `v=0\r\n${candidate.repeat(24)}` },
    };

    const legacy = encodeFriendRoomSignalV1(signal);
    const compact = await encodeFriendRoomSignalV2(signal);

    expect(compact).toMatch(/^AGFR2\./);
    expect(compact.length).toBeLessThan(legacy.length * 0.35);
    expect(await decodeFriendRoomSignal(compact)).toEqual(signal);
    expect(await decodeFriendRoomSignal(legacy)).toEqual(signal);
  });

  it('压缩后仍能回读接近 SDP 上限且不易压缩的邀请', async () => {
    let sdp = 'v=0\r\n';
    let state = 0x12345678;
    while (sdp.length < 90_000) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      sdp += String.fromCharCode(33 + (state % 90));
    }
    const signal = {
      protocol: 'agentic-game-friend-signal' as const,
      version: 1 as const,
      sessionId: 'friend-large-1',
      kind: 'offer' as const,
      description: { type: 'offer' as const, sdp },
    };

    const compact = await encodeFriendRoomSignalV2(signal);
    expect(await decodeFriendRoomSignal(compact)).toEqual(signal);
  });

  it('无需房间服务器即可用 offer/answer 邀请串起双方 PeerConnection', async () => {
    const hostConnection = new FakePeerConnection();
    const host = await createFriendRoomHostOfferV1(hostConnection, { sessionId: 'friend-session-4' });

    expect(hostConnection.labels).toEqual(['agentic-game-friend-room-v1']);
    expect(host.inviteCode).toMatch(/^AGFR2\./);
    expect(await decodeFriendRoomSignal(host.inviteCode)).toEqual({
      protocol: 'agentic-game-friend-signal',
      version: 1,
      sessionId: 'friend-session-4',
      kind: 'offer',
      description: { type: 'offer', sdp: 'v=0\r\na=host-offer' },
    });

    const guestConnection = new FakePeerConnection();
    const guest = await createFriendRoomGuestAnswerV1(guestConnection, host.inviteCode);
    const guestPeer = await guest.peerReady;
    expect(guest.sessionId).toBe('friend-session-4');
    expect(guestConnection.remoteDescription?.type).toBe('offer');
    expect(guestPeer).toBeDefined();

    await acceptFriendRoomHostAnswerV1(hostConnection, guest.answerCode, 'friend-session-4');
    expect(hostConnection.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0\r\na=guest-answer' });
  });

  it('拒绝会话不匹配和方向错误的信令包', async () => {
    const hostConnection = new FakePeerConnection();
    const wrongAnswer = encodeFriendRoomSignalV1({
      protocol: 'agentic-game-friend-signal',
      version: 1,
      sessionId: 'another-session',
      kind: 'answer',
      description: { type: 'answer', sdp: 'v=0\r\na=answer' },
    });
    const offer = encodeFriendRoomSignalV1({
      protocol: 'agentic-game-friend-signal',
      version: 1,
      sessionId: 'friend-session-5',
      kind: 'offer',
      description: { type: 'offer', sdp: 'v=0\r\na=offer' },
    });

    await expect(acceptFriendRoomHostAnswerV1(hostConnection, wrongAnswer, 'friend-session-5'))
      .rejects.toThrow('Signal session does not match');
    await expect(acceptFriendRoomHostAnswerV1(hostConnection, offer, 'friend-session-5'))
      .rejects.toThrow('Expected an answer signal');
    expect(() => decodeFriendRoomSignalV1('AGFR1.%7Bbad-json')).toThrow('Invalid friend signal code');
  });
});
