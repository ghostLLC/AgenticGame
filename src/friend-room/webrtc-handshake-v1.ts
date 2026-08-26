import {
  FriendDataChannelPeerV1,
  type FriendDataChannelLikeV1,
  type FriendDataChannelPeerOptionsV1,
} from './data-channel-peer-v1.js';

export interface FriendSessionDescriptionV1 {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface FriendWebRtcPeerConnectionLikeV1 {
  readonly localDescription: FriendSessionDescriptionV1 | null;
  readonly remoteDescription: FriendSessionDescriptionV1 | null;
  readonly iceGatheringState: 'new' | 'gathering' | 'complete';
  createDataChannel(label: string): FriendDataChannelLikeV1;
  createOffer(): Promise<FriendSessionDescriptionV1>;
  createAnswer(): Promise<FriendSessionDescriptionV1>;
  setLocalDescription(description: FriendSessionDescriptionV1): Promise<void>;
  setRemoteDescription(description: FriendSessionDescriptionV1): Promise<void>;
  addEventListener(
    type: 'icegatheringstatechange' | 'datachannel',
    listener: (() => void) | ((event: { channel: FriendDataChannelLikeV1 }) => void),
  ): void;
  removeEventListener(
    type: 'icegatheringstatechange' | 'datachannel',
    listener: (() => void) | ((event: { channel: FriendDataChannelLikeV1 }) => void),
  ): void;
}

export interface FriendRoomSignalV1 {
  protocol: 'agentic-game-friend-signal';
  version: 1;
  sessionId: string;
  kind: 'offer' | 'answer';
  description: FriendSessionDescriptionV1;
}

export interface FriendRoomHostOfferOptionsV1 {
  sessionId: string;
  iceGatheringTimeoutMs?: number;
  dataChannel?: FriendDataChannelPeerOptionsV1;
}

export interface FriendRoomGuestAnswerOptionsV1 {
  iceGatheringTimeoutMs?: number;
  dataChannel?: FriendDataChannelPeerOptionsV1;
}

export interface FriendRoomHostOfferV1 {
  inviteCode: string;
  peer: FriendDataChannelPeerV1;
}

export interface FriendRoomGuestAnswerV1 {
  sessionId: string;
  answerCode: string;
  peerReady: Promise<FriendDataChannelPeerV1>;
}

const SIGNAL_PREFIX = 'AGFR1.';
const DATA_CHANNEL_LABEL = 'agentic-game-friend-room-v1';
const MAX_SIGNAL_CHARACTERS = 200_000;

export async function createFriendRoomHostOfferV1(
  connection: FriendWebRtcPeerConnectionLikeV1,
  options: FriendRoomHostOfferOptionsV1,
): Promise<FriendRoomHostOfferV1> {
  validateSessionId(options.sessionId);
  const channel = connection.createDataChannel(DATA_CHANNEL_LABEL);
  const peer = new FriendDataChannelPeerV1(channel, options.dataChannel);
  const offer = validateDescription(await connection.createOffer(), 'offer');
  await connection.setLocalDescription(offer);
  await waitForIceGathering(connection, options.iceGatheringTimeoutMs);
  const description = validateDescription(connection.localDescription ?? offer, 'offer');
  return {
    inviteCode: encodeFriendRoomSignalV1({
      protocol: 'agentic-game-friend-signal',
      version: 1,
      sessionId: options.sessionId,
      kind: 'offer',
      description,
    }),
    peer,
  };
}

export async function createFriendRoomGuestAnswerV1(
  connection: FriendWebRtcPeerConnectionLikeV1,
  inviteCode: string,
  options: FriendRoomGuestAnswerOptionsV1 = {},
): Promise<FriendRoomGuestAnswerV1> {
  const signal = decodeFriendRoomSignalV1(inviteCode);
  if (signal.kind !== 'offer') throw new Error('Expected an offer signal');
  const peerReady = waitForDataChannel(connection, options.dataChannel);
  await connection.setRemoteDescription(signal.description);
  const answer = validateDescription(await connection.createAnswer(), 'answer');
  await connection.setLocalDescription(answer);
  await waitForIceGathering(connection, options.iceGatheringTimeoutMs);
  const description = validateDescription(connection.localDescription ?? answer, 'answer');
  return {
    sessionId: signal.sessionId,
    answerCode: encodeFriendRoomSignalV1({
      protocol: 'agentic-game-friend-signal',
      version: 1,
      sessionId: signal.sessionId,
      kind: 'answer',
      description,
    }),
    peerReady,
  };
}

export async function acceptFriendRoomHostAnswerV1(
  connection: FriendWebRtcPeerConnectionLikeV1,
  answerCode: string,
  expectedSessionId: string,
): Promise<void> {
  validateSessionId(expectedSessionId);
  const signal = decodeFriendRoomSignalV1(answerCode);
  if (signal.kind !== 'answer') throw new Error('Expected an answer signal');
  if (signal.sessionId !== expectedSessionId) throw new Error('Signal session does not match');
  await connection.setRemoteDescription(signal.description);
}

export function encodeFriendRoomSignalV1(signal: FriendRoomSignalV1): string {
  const validated = validateSignal(signal);
  return `${SIGNAL_PREFIX}${encodeURIComponent(JSON.stringify(validated))}`;
}

export function decodeFriendRoomSignalV1(code: string): FriendRoomSignalV1 {
  if (!code.startsWith(SIGNAL_PREFIX) || code.length > MAX_SIGNAL_CHARACTERS) {
    throw new Error('Invalid friend signal code');
  }
  let value: unknown;
  try {
    value = JSON.parse(decodeURIComponent(code.slice(SIGNAL_PREFIX.length)));
  } catch {
    throw new Error('Invalid friend signal code');
  }
  return validateSignal(value);
}

function validateSignal(value: unknown): FriendRoomSignalV1 {
  if (!isRecord(value)) throw new Error('Invalid friend signal code');
  if (
    value.protocol !== 'agentic-game-friend-signal'
    || value.version !== 1
    || (value.kind !== 'offer' && value.kind !== 'answer')
    || typeof value.sessionId !== 'string'
  ) throw new Error('Invalid friend signal code');
  validateSessionId(value.sessionId);
  const description = validateDescription(value.description, value.kind);
  return {
    protocol: 'agentic-game-friend-signal',
    version: 1,
    sessionId: value.sessionId,
    kind: value.kind,
    description,
  };
}

function validateDescription(value: unknown, expectedType: 'offer' | 'answer'): FriendSessionDescriptionV1 {
  if (
    !isRecord(value)
    || value.type !== expectedType
    || typeof value.sdp !== 'string'
    || value.sdp.length < 1
    || value.sdp.length > 100_000
  ) throw new Error(`Invalid ${expectedType} session description`);
  return { type: expectedType, sdp: value.sdp };
}

function waitForDataChannel(
  connection: FriendWebRtcPeerConnectionLikeV1,
  options: FriendDataChannelPeerOptionsV1 | undefined,
): Promise<FriendDataChannelPeerV1> {
  return new Promise((resolve) => {
    const listener = (event: { channel: FriendDataChannelLikeV1 }) => {
      connection.removeEventListener('datachannel', listener);
      resolve(new FriendDataChannelPeerV1(event.channel, options));
    };
    connection.addEventListener('datachannel', listener);
  });
}

async function waitForIceGathering(
  connection: FriendWebRtcPeerConnectionLikeV1,
  timeoutMs = 10_000,
): Promise<void> {
  if (connection.iceGatheringState === 'complete') return;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('iceGatheringTimeoutMs must contain 1-60000 milliseconds');
  }
  await new Promise<void>((resolve, reject) => {
    const listener = () => {
      if (connection.iceGatheringState !== 'complete') return;
      cleanup();
      resolve();
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('ICE gathering timed out'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      connection.removeEventListener('icegatheringstatechange', listener);
    };
    connection.addEventListener('icegatheringstatechange', listener);
  });
}

function validateSessionId(value: string): void {
  if (!/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value) || value.length > 64) {
    throw new Error('sessionId must be a stable ID');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
