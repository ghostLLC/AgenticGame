import type { FriendRoomPeerV1 } from './session-v1.js';

export interface FriendDataChannelLikeV1 {
  readonly readyState: string;
  send(data: string): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export interface FriendDataChannelPeerOptionsV1 {
  frameCharacters?: number;
  maxMessageCharacters?: number;
}

interface FrameV1 {
  protocol: 'agentic-game-friend-frame';
  version: 1;
  messageId: string;
  index: number;
  total: number;
  chunk: string;
}

interface PendingMessageV1 {
  total: number;
  characters: number;
  chunks: Array<string | undefined>;
}

export class FriendDataChannelPeerV1 implements FriendRoomPeerV1 {
  private readonly channel: FriendDataChannelLikeV1;
  private readonly frameCharacters: number;
  private readonly maxMessageCharacters: number;
  private readonly listeners = new Set<(payload: string) => void>();
  private readonly pending = new Map<string, PendingMessageV1>();
  private nextMessageId = 1;
  private readonly onMessage = (event: { data: unknown }) => this.receive(event.data);

  constructor(channel: FriendDataChannelLikeV1, options: FriendDataChannelPeerOptionsV1 = {}) {
    this.channel = channel;
    this.frameCharacters = options.frameCharacters ?? 16_384;
    this.maxMessageCharacters = options.maxMessageCharacters ?? 1_048_576;
    if (!Number.isSafeInteger(this.frameCharacters) || this.frameCharacters < 64) {
      throw new Error('frameCharacters must be an integer of at least 64');
    }
    if (!Number.isSafeInteger(this.maxMessageCharacters) || this.maxMessageCharacters < this.frameCharacters) {
      throw new Error('maxMessageCharacters must be an integer no smaller than frameCharacters');
    }
    channel.addEventListener('message', this.onMessage);
  }

  send(payload: string): void {
    if (this.channel.readyState !== 'open') throw new Error('Peer data channel is not open');
    if (payload.length > this.maxMessageCharacters) throw new Error('Peer message is too large');
    const total = Math.max(1, Math.ceil(payload.length / this.frameCharacters));
    const messageId = `m${this.nextMessageId}`;
    this.nextMessageId += 1;
    for (let index = 0; index < total; index += 1) {
      const frame: FrameV1 = {
        protocol: 'agentic-game-friend-frame',
        version: 1,
        messageId,
        index,
        total,
        chunk: payload.slice(index * this.frameCharacters, (index + 1) * this.frameCharacters),
      };
      this.channel.send(JSON.stringify(frame));
    }
  }

  subscribe(listener: (payload: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.channel.removeEventListener('message', this.onMessage);
    this.listeners.clear();
    this.pending.clear();
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') throw new Error('Peer frame must be text');
    const frame = parseFrame(data);
    const current = this.pending.get(frame.messageId) ?? {
      total: frame.total,
      characters: 0,
      chunks: new Array<string | undefined>(frame.total).fill(undefined),
    };
    if (current.total !== frame.total) throw new Error('Peer frame total changed during reassembly');
    if (current.chunks[frame.index] === undefined) {
      current.chunks[frame.index] = frame.chunk;
      current.characters += frame.chunk.length;
    }
    if (current.characters > this.maxMessageCharacters) {
      this.pending.delete(frame.messageId);
      throw new Error('Peer message is too large');
    }
    this.pending.set(frame.messageId, current);
    if (current.chunks.every((chunk) => chunk !== undefined)) {
      this.pending.delete(frame.messageId);
      const payload = current.chunks.join('');
      this.listeners.forEach((listener) => listener(payload));
    }
  }
}

function parseFrame(payload: string): FrameV1 {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error('Peer frame must be JSON');
  }
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || (value as Record<string, unknown>).protocol !== 'agentic-game-friend-frame'
    || (value as Record<string, unknown>).version !== 1
  ) throw new Error('Peer frame has an invalid envelope');
  const frame = value as Record<string, unknown>;
  if (
    typeof frame.messageId !== 'string'
    || !/^m[1-9]\d*$/.test(frame.messageId)
    || !Number.isSafeInteger(frame.index)
    || !Number.isSafeInteger(frame.total)
    || (frame.total as number) < 1
    || (frame.total as number) > 65_536
    || (frame.index as number) < 0
    || (frame.index as number) >= (frame.total as number)
    || typeof frame.chunk !== 'string'
  ) throw new Error('Peer frame is invalid');
  return frame as unknown as FrameV1;
}
