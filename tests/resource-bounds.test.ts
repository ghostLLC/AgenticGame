import { describe, expect, it, vi } from 'vitest';
import { FriendDataChannelPeerV1, type FriendDataChannelEventTypeV1, type FriendDataChannelEventV1 } from '../src/friend-room/data-channel-peer-v1.js';
import { requestProviderJsonV1 } from '../src/agent/providers/provider-http-v1.js';
import { createPresetBuildV1 } from '../src/desktop/preset-builds-v1.js';
import { GAMEPLAY_CONTENT_V2, GAMEPLAY_MAP_FRONTIER_V2 } from '../src/core/v2/gameplay-content.js';
import { runPracticeMatchV2 } from '../src/practice/run-practice-match-v2.js';

class Channel {
  readyState = 'open'; bufferedAmount = 0; sent: string[] = [];
  listeners = new Map<string, Set<(event: FriendDataChannelEventV1) => void>>();
  send(value: string) { this.sent.push(value); }
  addEventListener(type: FriendDataChannelEventTypeV1, fn: (event: FriendDataChannelEventV1) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: FriendDataChannelEventTypeV1, fn: (event: FriendDataChannelEventV1) => void) { this.listeners.get(type)?.delete(fn); }
  emit(type: FriendDataChannelEventTypeV1, data?: unknown) { this.listeners.get(type)?.forEach((fn) => fn({ data })); }
}
const frame = (messageId: string, total = 2) => JSON.stringify({ protocol: 'agentic-game-friend-frame', version: 1, messageId, index: 0, total, chunk: 'x' });

describe('bounded external input', () => {
  it('limits unfinished messages and rejects impossible frame totals without allocating a large array', () => {
    const channel = new Channel(); const peer = new FriendDataChannelPeerV1(channel);
    for (let index = 1; index <= 4; index++) channel.emit('message', frame(`m${index}`));
    expect(peer.getBufferUsage()).toEqual({ messages: 4, characters: 4 });
    channel.emit('message', frame('m5'));
    expect(peer.getBufferUsage().messages).toBe(0);
    peer.dispose();
    const other = new FriendDataChannelPeerV1(channel);
    channel.emit('message', frame('m1', 65536)); expect(other.getBufferUsage().messages).toBe(0); other.dispose();
  });

  it('expires partial frames, clears on close, and applies backpressure before sending any frame', () => {
    vi.useFakeTimers();
    try {
      const channel = new Channel(); const peer = new FriendDataChannelPeerV1(channel, { assemblyTimeoutMs: 10 });
      channel.emit('message', frame('m1')); vi.advanceTimersByTime(11);
      expect(peer.getBufferUsage().messages).toBe(0);
      channel.bufferedAmount = 8 * 1024 * 1024;
      expect(() => peer.send('hello')).toThrow('传输'); expect(channel.sent).toHaveLength(0);
      channel.emit('message', frame('m2')); channel.emit('close');
      expect(peer.getBufferUsage().messages).toBe(0); peer.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('cancels a streaming HTTP body as soon as the byte budget is exceeded', async () => {
    let chunks = 0; let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
    await expect(requestProviderJsonV1({ label: 'test', url: 'https://provider.example', secret: '', init: {}, maxResponseBytes: 2048,
      fetch: async () => new Response(body) })).rejects.toThrow('too large');
    expect(cancelled).toBe(true); expect(chunks).toBeLessThanOrEqual(4);
  });

  it('propagates cancellation into a real running match instead of waiting for all ticks', async () => {
    const controller = new AbortController();
    const current = createPresetBuildV1('medium', '2026-09-01T00:00:00.000Z');
    let ticks = 0;
    await expect(runPracticeMatchV2({ current, opponent: current, contentSnapshot: GAMEPLAY_CONTENT_V2, mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      seed: 4, maxTicks: 1000, signal: controller.signal, onProgress(tick) { ticks++; if (tick === 2) controller.abort(new Error('cancel regression')); }
    })).rejects.toThrow('cancel regression');
    expect(ticks).toBe(3);
  });
});
