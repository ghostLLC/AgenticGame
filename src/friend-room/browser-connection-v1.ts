import type { FriendDataChannelPeerOptionsV1 } from './data-channel-peer-v1.js';
import { type FriendDataChannelPeerV1, type FriendDataChannelStateV1 } from './data-channel-peer-v1.js';
import {
  acceptFriendRoomHostAnswerV1,
  createFriendRoomGuestAnswerV1,
  createFriendRoomHostOfferV1,
  type FriendWebRtcPeerConnectionLikeV1,
} from './webrtc-handshake-v1.js';

export type FriendRoomRoleV1 = 'host' | 'guest';

export type FriendIceProfileV1 =
  | { mode: 'direct' }
  | { mode: 'stun'; urls: string[] }
  | { mode: 'turn'; urls: string[]; username: string; credential: string; stunUrls?: string[] };

export interface FriendRtcIceServerV1 {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface FriendRtcConfigurationV1 {
  iceServers: FriendRtcIceServerV1[];
}

export interface FriendBrowserRtcEnvironmentV1 {
  RTCPeerConnection?: new (configuration: FriendRtcConfigurationV1) => FriendWebRtcPeerConnectionLikeV1;
}

export type FriendRoomBrowserConnectionStateV1 =
  | 'idle'
  | 'gathering'
  | 'waiting-answer'
  | 'waiting-host'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

export interface FriendRoomBrowserConnectionOptionsV1 {
  role: FriendRoomRoleV1;
  ice: FriendIceProfileV1;
  browser?: FriendBrowserRtcEnvironmentV1;
  iceGatheringTimeoutMs?: number;
  dataChannel?: FriendDataChannelPeerOptionsV1;
}

export function createDefaultFriendRoomIceProfileV1(): FriendIceProfileV1 {
  return { mode: 'stun', urls: ['stun:stun.cloudflare.com:3478'] };
}

export function createFriendRoomRtcConfigurationV1(profile: FriendIceProfileV1): FriendRtcConfigurationV1 {
  if (profile.mode === 'direct') return { iceServers: [] };
  if (profile.mode === 'stun') {
    return { iceServers: [{ urls: validateIceUrls(profile.urls, ['stun:', 'stuns:'], 'STUN') }] };
  }
  const username = profile.username.trim();
  const credential = profile.credential.trim();
  if (!username || !credential) throw new Error('TURN username and credential are required');
  const iceServers: FriendRtcIceServerV1[] = [];
  if (profile.stunUrls?.length) {
    iceServers.push({ urls: validateIceUrls(profile.stunUrls, ['stun:', 'stuns:'], 'STUN') });
  }
  iceServers.push({
    urls: validateIceUrls(profile.urls, ['turn:', 'turns:'], 'TURN'),
    username,
    credential,
  });
  return { iceServers };
}

export class FriendRoomBrowserConnectionV1 {
  private readonly role: FriendRoomRoleV1;
  private readonly connection: FriendWebRtcPeerConnectionLikeV1;
  private readonly iceGatheringTimeoutMs: number | undefined;
  private readonly dataChannel: FriendDataChannelPeerOptionsV1 | undefined;
  private state: FriendRoomBrowserConnectionStateV1 = 'idle';
  private sessionId: string | undefined;
  private peer: FriendDataChannelPeerV1 | undefined;
  private unsubscribePeerState: (() => void) | undefined;
  private readonly stateListeners = new Set<(state: FriendRoomBrowserConnectionStateV1) => void>();

  constructor(options: FriendRoomBrowserConnectionOptionsV1) {
    const browser = options.browser ?? readBrowserEnvironment();
    if (!browser.RTCPeerConnection) throw new Error('WebRTC is not available');
    this.role = options.role;
    this.iceGatheringTimeoutMs = options.iceGatheringTimeoutMs;
    this.dataChannel = options.dataChannel;
    this.connection = new browser.RTCPeerConnection(createFriendRoomRtcConfigurationV1(options.ice));
  }

  getState(): FriendRoomBrowserConnectionStateV1 {
    return this.state;
  }

  getPeer(): FriendDataChannelPeerV1 | undefined {
    return this.peer;
  }

  subscribeState(listener: (state: FriendRoomBrowserConnectionStateV1) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  async createInvite(sessionId: string): Promise<string> {
    try {
      if (this.role !== 'host') throw new Error('Only the host can create an invite');
      if (this.state !== 'idle') throw new Error('Connection has already started');
      this.setState('gathering');
      const result = await createFriendRoomHostOfferV1(this.connection, {
        sessionId,
        iceGatheringTimeoutMs: this.iceGatheringTimeoutMs,
        dataChannel: this.dataChannel,
      });
      this.sessionId = sessionId;
      this.attachPeer(result.peer);
      this.setState('waiting-answer');
      return result.inviteCode;
    } catch (error) {
      this.setState('failed');
      throw error;
    }
  }

  async acceptInvite(inviteCode: string): Promise<string> {
    try {
      if (this.role !== 'guest') throw new Error('Only the guest can accept an invite');
      if (this.state !== 'idle') throw new Error('Connection has already started');
      this.setState('gathering');
      const result = await createFriendRoomGuestAnswerV1(this.connection, inviteCode, {
        iceGatheringTimeoutMs: this.iceGatheringTimeoutMs,
        dataChannel: this.dataChannel,
      });
      this.sessionId = result.sessionId;
      this.setState('waiting-host');
      void result.peerReady.then((peer) => this.attachPeer(peer), () => this.setState('failed'));
      return result.answerCode;
    } catch (error) {
      this.setState('failed');
      throw error;
    }
  }

  async acceptAnswer(answerCode: string): Promise<void> {
    try {
      if (this.role !== 'host') throw new Error('Only the host can accept an answer');
      if (this.state !== 'waiting-answer' || !this.sessionId) throw new Error('Host is not waiting for an answer');
      await acceptFriendRoomHostAnswerV1(this.connection, answerCode, this.sessionId);
      this.setState(this.peer?.getReadyState() === 'open' ? 'connected' : 'connecting');
    } catch (error) {
      this.setState('failed');
      throw error;
    }
  }

  dispose(): void {
    this.unsubscribePeerState?.();
    this.unsubscribePeerState = undefined;
    this.peer?.dispose();
    this.peer = undefined;
    this.stateListeners.clear();
  }

  private attachPeer(peer: FriendDataChannelPeerV1): void {
    this.unsubscribePeerState?.();
    this.peer = peer;
    this.unsubscribePeerState = peer.subscribeState((state) => this.onPeerState(state));
  }

  private onPeerState(state: FriendDataChannelStateV1): void {
    if (state === 'open') this.setState('connected');
    else if (state === 'closed') this.setState('disconnected');
    else if (state === 'error') this.setState('failed');
    else if (this.state === 'connecting') this.setState('connecting');
  }

  private setState(state: FriendRoomBrowserConnectionStateV1): void {
    if (this.state === state) return;
    this.state = state;
    this.stateListeners.forEach((listener) => listener(state));
  }
}

function validateIceUrls(urls: string[], prefixes: string[], label: 'STUN' | 'TURN'): string[] {
  const normalized = [...new Set(urls.map((url) => url.trim()))];
  if (!normalized.length || normalized.some((url) => !prefixes.some((prefix) => url.startsWith(prefix)))) {
    throw new Error(`Invalid ${label} URL`);
  }
  return normalized;
}

function readBrowserEnvironment(): FriendBrowserRtcEnvironmentV1 {
  return globalThis as unknown as FriendBrowserRtcEnvironmentV1;
}
