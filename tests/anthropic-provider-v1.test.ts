import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProviderV1 } from '../src/agent/providers/anthropic-v1.js';

describe('Anthropic Messages BYOK provider v1', () => {
  it('translates system, tools, tool results and tool calls without putting the key in the body', async () => {
    const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-api-key')).toBe('ant-private');
      expect(headers.get('anthropic-version')).toBe('2023-06-01');
      const body = JSON.parse(String(init?.body));
      expect(body.system).toBe('Stay scoped.');
      expect(body.messages).toEqual([
        { role: 'user', content: [{ type: 'text', text: 'Improve.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'call-1', name: 'echo', input: { text: 'ready' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '{"echoed":"ready"}' }] },
      ]);
      expect(String(init?.body)).not.toContain('ant-private');
      return new Response(JSON.stringify({
        content: [
          { type: 'text', text: 'Candidate ready.' },
          { type: 'tool_use', id: 'call-2', name: 'evaluate_bot', input: { seed: 7 } },
        ],
      }));
    });
    const provider = createAnthropicProviderV1({
      baseUrl: 'https://api.anthropic.com/v1/', apiKey: 'ant-private', model: 'claude-test',
      fetch: fakeFetch as typeof fetch,
    });
    const reply = await provider.complete({
      messages: [
        { role: 'system', content: 'Stay scoped.' },
        { role: 'user', content: 'Improve.' },
        { role: 'assistant', content: 'Checking.', toolCalls: [{ id: 'call-1', name: 'echo', arguments: { text: 'ready' } }] },
        { role: 'tool', content: '{"echoed":"ready"}', toolCallId: 'call-1', name: 'echo' },
      ],
      tools: [{ name: 'evaluate_bot', description: 'Evaluate.', inputSchema: { type: 'object' }, execute: async () => ({}) }],
    });
    expect(fakeFetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.any(Object));
    expect(reply).toEqual({
      content: 'Candidate ready.',
      toolCalls: [{ id: 'call-2', name: 'evaluate_bot', arguments: { seed: 7 } }],
    });
    expect(provider.redactSensitiveText?.('key=ant-private')).toBe('key=[REDACTED]');
    expect(JSON.stringify(provider)).not.toContain('ant-private');
  });

  it('rejects lookalike loopback hosts and redacts provider errors', async () => {
    expect(() => createAnthropicProviderV1({
      baseUrl: 'http://localhost.attacker.example/v1', apiKey: 'key', model: 'model',
    })).toThrow('must use HTTPS or an explicit loopback host');
    const provider = createAnthropicProviderV1({
      baseUrl: 'https://api.anthropic.com/v1', apiKey: 'ant-private', model: 'model',
      fetch: async () => new Response('bad ant-private', { status: 401 }),
    });
    await expect(provider.complete({ messages: [], tools: [] }))
      .rejects.toThrow('Anthropic request failed (401): bad [REDACTED]');
  });

  it('honors cancellation and response size limits', async () => {
    const controller = new AbortController();
    controller.abort(new Error('player cancelled'));
    const cancelled = createAnthropicProviderV1({
      baseUrl: 'https://api.anthropic.com/v1', apiKey: 'key', model: 'model',
      fetch: async (_url, init) => {
        if (init?.signal?.aborted) throw init.signal.reason;
        return new Response('{}');
      },
    });
    await expect(cancelled.complete({ messages: [], tools: [], signal: controller.signal }))
      .rejects.toThrow('player cancelled');

    const oversized = createAnthropicProviderV1({
      baseUrl: 'https://api.anthropic.com/v1', apiKey: 'key', model: 'model', maxResponseBytes: 16,
      fetch: async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'x'.repeat(50) }] })),
    });
    await expect(oversized.complete({ messages: [], tools: [] })).rejects.toThrow('response was too large');
  });
});
