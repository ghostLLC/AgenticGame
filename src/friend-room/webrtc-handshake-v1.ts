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
  close?(): void;
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
const COMPACT_SIGNAL_PREFIX = 'AGFR2.';
const DATA_CHANNEL_LABEL = 'agentic-game-friend-room-v1';
const MAX_SIGNAL_CHARACTERS = 200_000;
const MAX_COMPACT_SIGNAL_CHARACTERS = 200_000;
const MAX_DECOMPRESSED_SIGNAL_BYTES = 150_000;

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
    inviteCode: await encodeFriendRoomSignalV2({
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
  const signal = await decodeFriendRoomSignal(inviteCode);
  if (signal.kind !== 'offer') throw new Error('Expected an offer signal');
  const peerReady = waitForDataChannel(connection, options.dataChannel);
  await connection.setRemoteDescription(signal.description);
  const answer = validateDescription(await connection.createAnswer(), 'answer');
  await connection.setLocalDescription(answer);
  await waitForIceGathering(connection, options.iceGatheringTimeoutMs);
  const description = validateDescription(connection.localDescription ?? answer, 'answer');
  return {
    sessionId: signal.sessionId,
    answerCode: await encodeFriendRoomSignalV2({
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
  const signal = await decodeFriendRoomSignal(answerCode);
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

export async function encodeFriendRoomSignalV2(signal: FriendRoomSignalV1): Promise<string> {
  const validated = validateSignal(signal);
  const compact: [string, 0 | 1, string] = [
    validated.sessionId,
    validated.kind === 'offer' ? 0 : 1,
    validated.description.sdp,
  ];
  const compressed = await compressBytes(new TextEncoder().encode(JSON.stringify(compact)));
  return `${COMPACT_SIGNAL_PREFIX}${encodeBase64Url(compressed)}`;
}

export async function decodeFriendRoomSignal(code: string): Promise<FriendRoomSignalV1> {
  if (code.startsWith(SIGNAL_PREFIX)) return decodeFriendRoomSignalV1(code);
  if (!code.startsWith(COMPACT_SIGNAL_PREFIX) || code.length > MAX_COMPACT_SIGNAL_CHARACTERS) {
    throw new Error('Invalid friend signal code');
  }
  try {
    const compressed = decodeBase64Url(code.slice(COMPACT_SIGNAL_PREFIX.length));
    const bytes = await decompressBytes(compressed);
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    if (!Array.isArray(value) || value.length !== 3) throw new Error('invalid tuple');
    const [sessionId, kindCode, sdp] = value;
    if (typeof sessionId !== 'string' || (kindCode !== 0 && kindCode !== 1) || typeof sdp !== 'string') {
      throw new Error('invalid tuple');
    }
    const kind = kindCode === 0 ? 'offer' : 'answer';
    return validateSignal({
      protocol: 'agentic-game-friend-signal',
      version: 1,
      sessionId,
      kind,
      description: { type: kind, sdp },
    });
  } catch {
    throw new Error('Invalid friend signal code');
  }
}

async function compressBytes(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([ownedArrayBuffer(input)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompressBytes(input: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([ownedArrayBuffer(input)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DECOMPRESSED_SIGNAL_BYTES) {
      await reader.cancel();
      throw new Error('signal is too large');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function ownedArrayBuffer(input: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(input.byteLength);
  new Uint8Array(output).set(input);
  return output;
}

const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeBase64Url(input: Uint8Array): string {
  let output = '';
  for (let index = 0; index < input.length; index += 3) {
    const first = input[index]!;
    const second = input[index + 1];
    const third = input[index + 2];
    output += BASE64_URL_ALPHABET[first >>> 2];
    output += BASE64_URL_ALPHABET[((first & 3) << 4) | ((second ?? 0) >>> 4)];
    if (second !== undefined) output += BASE64_URL_ALPHABET[((second & 15) << 2) | ((third ?? 0) >>> 6)];
    if (third !== undefined) output += BASE64_URL_ALPHABET[third & 63];
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64');
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64_URL_ALPHABET.indexOf(value[index]!);
    const b = BASE64_URL_ALPHABET.indexOf(value[index + 1]!);
    const c = value[index + 2] === undefined ? -1 : BASE64_URL_ALPHABET.indexOf(value[index + 2]!);
    const d = value[index + 3] === undefined ? -1 : BASE64_URL_ALPHABET.indexOf(value[index + 3]!);
    if (a < 0 || b < 0 || (c < 0 && value[index + 2] !== undefined) || (d < 0 && value[index + 3] !== undefined)) {
      throw new Error('invalid base64');
    }
    bytes.push((a << 2) | (b >>> 4));
    if (c >= 0) bytes.push(((b & 15) << 4) | (c >>> 2));
    if (d >= 0) bytes.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(bytes);
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
