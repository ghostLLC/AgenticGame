import type { FriendRoomPeerV1 } from './session-v1.js';

export type FriendDataChannelEventTypeV1 = 'message' | 'open' | 'close' | 'error';

export interface FriendDataChannelEventV1 {
  data?: unknown;
}

export type FriendDataChannelStateV1 = 'connecting' | 'open' | 'closed' | 'error';

export interface FriendDataChannelLikeV1 {
  readonly readyState: string;
  readonly bufferedAmount?: number;
  send(data: string): void;
  addEventListener(type: FriendDataChannelEventTypeV1, listener: (event: FriendDataChannelEventV1) => void): void;
  removeEventListener(type: FriendDataChannelEventTypeV1, listener: (event: FriendDataChannelEventV1) => void): void;
}

export interface FriendDataChannelPeerOptionsV1 {
  frameCharacters?: number;
  maxMessageCharacters?: number;
  assemblyTimeoutMs?: number;
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
  chunks: Map<number, string>;
  timer: ReturnType<typeof setTimeout>;
}

export class FriendDataChannelPeerV1 implements FriendRoomPeerV1 {
  private readonly channel: FriendDataChannelLikeV1;
  private readonly frameCharacters: number;
  private readonly maxMessageCharacters: number;
  private readonly listeners = new Set<(payload: string) => void>();
  private readonly stateListeners = new Set<(state: FriendDataChannelStateV1) => void>();
  private readonly pending = new Map<string, PendingMessageV1>();
  private nextMessageId = 1;
  private closed = false;
  private readonly assemblyTimeoutMs: number;
  private readonly onMessage = (event: FriendDataChannelEventV1) => {
    if (this.closed) return;
    try { this.receive(event.data); } catch { this.clearPending(); this.closed = true; this.emitState('error'); }
  };
  private readonly onOpen = () => this.emitState('open');
  private readonly onClose = () => { this.closed = true; this.clearPending(); this.emitState('closed'); };
  private readonly onError = () => { this.closed = true; this.clearPending(); this.emitState('error'); };

  constructor(channel: FriendDataChannelLikeV1, options: FriendDataChannelPeerOptionsV1 = {}) {
    this.channel = channel;
    this.frameCharacters = options.frameCharacters ?? 16_384;
    this.maxMessageCharacters = options.maxMessageCharacters ?? 1_048_576;
    this.assemblyTimeoutMs = options.assemblyTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.frameCharacters) || this.frameCharacters < 64 || this.frameCharacters > 16_384) {
      throw new Error('frameCharacters must be an integer of at least 64');
    }
    if (!Number.isSafeInteger(this.maxMessageCharacters) || this.maxMessageCharacters < this.frameCharacters || this.maxMessageCharacters > 1_048_576) {
      throw new Error('maxMessageCharacters must be an integer no smaller than frameCharacters');
    }
    if (!Number.isSafeInteger(this.assemblyTimeoutMs) || this.assemblyTimeoutMs < 1 || this.assemblyTimeoutMs > 30_000) throw new Error('Invalid frame expiry');
    channel.addEventListener('message', this.onMessage);
    channel.addEventListener('open', this.onOpen);
    channel.addEventListener('close', this.onClose);
    channel.addEventListener('error', this.onError);
  }

  send(payload: string): void {
    if (this.closed || this.channel.readyState !== 'open') throw new Error('Peer data channel is not open');
    if (payload.length > this.maxMessageCharacters) throw new Error('Peer message is too large');
    const total = Math.max(1, Math.ceil(payload.length / this.frameCharacters));
    const messageId = `m${this.nextMessageId}`;
    this.nextMessageId += 1;
    const frames: string[] = [];
    for (let index = 0; index < total; index += 1) {
      const frame: FrameV1 = {
        protocol: 'agentic-game-friend-frame',
        version: 1,
        messageId,
        index,
        total,
        chunk: payload.slice(index * this.frameCharacters, (index + 1) * this.frameCharacters),
      };
      frames.push(JSON.stringify(frame));
    }
    const bytes = frames.reduce((sum, frame) => sum + new TextEncoder().encode(frame).byteLength, 0);
    if ((this.channel.bufferedAmount ?? 0) + bytes > 8 * 1024 * 1024) throw new Error('好友连接正在传输，请稍后重试。');
    for (const frame of frames) this.channel.send(frame);
  }

  subscribe(listener: (payload: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getReadyState(): string {
    return this.channel.readyState;
  }

  subscribeState(listener: (state: FriendDataChannelStateV1) => void): () => void {
    this.stateListeners.add(listener);
    listener(normalizeReadyState(this.channel.readyState));
    return () => this.stateListeners.delete(listener);
  }

  dispose(): void {
    this.closed = true;
    this.channel.removeEventListener('message', this.onMessage);
    this.channel.removeEventListener('open', this.onOpen);
    this.channel.removeEventListener('close', this.onClose);
    this.channel.removeEventListener('error', this.onError);
    this.listeners.clear();
    this.stateListeners.clear();
    this.clearPending();
  }

  getBufferUsage(): { messages: number; characters: number } {
    return { messages: this.pending.size, characters: [...this.pending.values()].reduce((sum, message) => sum + message.characters, 0) };
  }

  private clearPending(): void {
    for (const message of this.pending.values()) clearTimeout(message.timer);
    this.pending.clear();
  }

  private emitState(state: FriendDataChannelStateV1): void {
    this.stateListeners.forEach((listener) => listener(state));
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') throw new Error('Peer frame must be text');
    if (data.length > this.frameCharacters * 6 + 512) throw new Error('Peer frame is too large');
    const frame = parseFrame(data);
    if (frame.total > Math.ceil(this.maxMessageCharacters / this.frameCharacters) || frame.chunk.length > this.frameCharacters) throw new Error('Peer frame exceeds negotiated limits');
    let current = this.pending.get(frame.messageId);
    if (!current) {
      if (this.pending.size >= 4) throw new Error('Too many unfinished peer messages');
      const timer = setTimeout(() => { this.pending.delete(frame.messageId); }, this.assemblyTimeoutMs);
      timer.unref?.();
      current = { total: frame.total, characters: 0, chunks: new Map(), timer };
      this.pending.set(frame.messageId, current);
    }
    if (current.total !== frame.total) throw new Error('Peer frame total changed during reassembly');
    if (current.chunks.has(frame.index) && current.chunks.get(frame.index) !== frame.chunk) throw new Error('Conflicting peer frame');
    if (!current.chunks.has(frame.index)) {
      current.chunks.set(frame.index, frame.chunk);
      current.characters += frame.chunk.length;
    }
    if (current.characters > this.maxMessageCharacters || this.getBufferUsage().characters > this.maxMessageCharacters * 2) {
      throw new Error('Peer message is too large');
    }
    if (current.chunks.size === current.total) {
      clearTimeout(current.timer);
      this.pending.delete(frame.messageId);
      const payload = Array.from({ length: current.total }, (_, index) => current.chunks.get(index)!).join('');
      this.listeners.forEach((listener) => listener(payload));
    }
  }
}

function normalizeReadyState(value: string): FriendDataChannelStateV1 {
  if (value === 'open') return 'open';
  if (value === 'closed' || value === 'closing') return 'closed';
  return 'connecting';
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
    || frame.messageId.length > 32
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
