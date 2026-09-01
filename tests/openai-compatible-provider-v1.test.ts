import { describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleProviderV1 } from '../src/agent/providers/openai-compatible-v1.js';

describe('OpenAI-compatible BYOK provider v1', () => {
  it('sends the key only in the authorization header and normalizes tool calls', async () => {
    const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer sk-private');
      expect(String(init?.body)).not.toContain('sk-private');
      expect(JSON.parse(String(init?.body))).toMatchObject({ max_tokens: 4096 });
      return new Response(JSON.stringify({
        choices: [{ message: {
          content: null,
          tool_calls: [{
            id: 'call-7', type: 'function',
            function: { name: 'evaluate_bot', arguments: '{"seed":7}' },
          }],
        } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const provider = createOpenAICompatibleProviderV1({
      baseUrl: 'https://provider.example/v1/',
      apiKey: 'sk-private',
      model: 'model-x',
      fetch: fakeFetch as typeof fetch,
    });

    const reply = await provider.complete({
      messages: [{ role: 'user', content: 'Test.' }],
      tools: [{
        name: 'evaluate_bot', description: 'Evaluate.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => ({}),
      }],
    });

    expect(fakeFetch).toHaveBeenCalledWith('https://provider.example/v1/chat/completions', expect.any(Object));
    expect(reply).toEqual({
      content: '',
      toolCalls: [{ id: 'call-7', name: 'evaluate_bot', arguments: { seed: 7 } }],
    });
    expect(provider.redactSensitiveText?.('key=sk-private')).toBe('key=[REDACTED]');
    expect(JSON.stringify(provider)).not.toContain('sk-private');
  });

  it('returns a useful error without leaking the key', async () => {
    const provider = createOpenAICompatibleProviderV1({
      baseUrl: 'https://provider.example/v1', apiKey: 'sk-private', model: 'model-x',
      fetch: async () => new Response('denied sk-private', { status: 401 }),
    });

    await expect(provider.complete({ messages: [], tools: [] }))
      .rejects.toThrow('OpenAI-compatible request failed (401): denied [REDACTED]');
  });

  it('rejects insecure lookalike hosts while allowing explicit loopback HTTP', () => {
    expect(() => createOpenAICompatibleProviderV1({
      baseUrl: 'http://localhost.evil.example/v1', apiKey: 'key', model: 'model',
    })).toThrow('must use HTTPS or an explicit loopback host');

    expect(() => createOpenAICompatibleProviderV1({
      baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'key', model: 'model',
    })).not.toThrow();
  });

  it('bounds response size and request duration', async () => {
    const oversized = createOpenAICompatibleProviderV1({
      baseUrl: 'https://provider.example/v1', apiKey: 'key', model: 'model',
      maxResponseBytes: 32,
      fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(100) } }] })),
    });
    await expect(oversized.complete({ messages: [], tools: [] })).rejects.toThrow('response was too large');

    const timedOut = createOpenAICompatibleProviderV1({
      baseUrl: 'https://provider.example/v1', apiKey: 'key', model: 'model', timeoutMs: 10,
      fetch: async (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    });
    await expect(timedOut.complete({ messages: [], tools: [] })).rejects.toThrow('request timed out');
  });
});
