import { describe, expect, it } from 'vitest';
import {
  runAgentHarnessV1,
  type AgentModelProviderV1,
  type AgentToolV1,
} from '../src/agent/harness-v1.js';

const echoTool: AgentToolV1 = {
  name: 'echo',
  description: 'Echo text for testing.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
  async execute(input) {
    return { echoed: input.text };
  },
};

describe('runAgentHarnessV1', () => {
  it('runs a bounded tool loop and returns a redacted transcript', async () => {
    const secret = 'sk-test-secret-value';
    let request = 0;
    const provider: AgentModelProviderV1 = {
      id: 'fake',
      redactSensitiveText: (value) => value.split(secret).join('[REDACTED]'),
      async complete(input) {
        request += 1;
        if (request === 1) {
          expect(input.tools.map((tool) => tool.name)).toEqual(['echo']);
          return {
            content: `I will not expose ${secret}`,
            toolCalls: [{ id: 'call-1', name: 'echo', arguments: { text: 'ready' } }],
          };
        }
        expect(input.messages.at(-1)).toMatchObject({
          role: 'tool', toolCallId: 'call-1', name: 'echo', content: '{"echoed":"ready"}',
        });
        return { content: 'Bot evaluation complete.' };
      },
    };

    const result = await runAgentHarnessV1({
      provider,
      tools: [echoTool],
      systemPrompt: 'Improve the bot.',
      userPrompt: 'Evaluate it.',
      limits: { maxTurns: 3, maxToolCalls: 2 },
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('Bot evaluation complete.');
    expect(result.usage).toEqual({ turns: 2, toolCalls: 1 });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result.transcript)).toContain('[REDACTED]');
  });

  it('does not execute tools outside the exact allowlist', async () => {
    let request = 0;
    const provider: AgentModelProviderV1 = {
      id: 'fake',
      async complete(input) {
        request += 1;
        if (request === 1) {
          return { toolCalls: [{ id: 'bad-1', name: 'read_file', arguments: { path: 'secret' } }] };
        }
        expect(input.messages.at(-1)?.content).toContain('tool_not_allowed');
        return { content: 'Cannot use that tool.' };
      },
    };

    const result = await runAgentHarnessV1({
      provider,
      tools: [echoTool],
      systemPrompt: 'Stay scoped.',
      userPrompt: 'Try something.',
    });

    expect(result.status).toBe('completed');
    expect(result.usage.toolCalls).toBe(0);
    expect(result.transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', name: 'read_file' }),
    ]));
  });

  it('stops before exceeding the turn or tool-call budgets', async () => {
    const provider: AgentModelProviderV1 = {
      id: 'loop',
      async complete() {
        return { toolCalls: [{ id: crypto.randomUUID(), name: 'echo', arguments: { text: 'again' } }] };
      },
    };

    const result = await runAgentHarnessV1({
      provider,
      tools: [echoTool],
      systemPrompt: 'Loop.',
      userPrompt: 'Loop.',
      limits: { maxTurns: 5, maxToolCalls: 2 },
    });

    expect(result.status).toBe('limit-reached');
    expect(result.stopReason).toBe('max-tool-calls');
    expect(result.usage).toEqual({ turns: 3, toolCalls: 2 });
  });
});
