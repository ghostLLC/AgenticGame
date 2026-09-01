import type {
  AgentMessageV1,
  AgentModelProviderV1,
  AgentModelReplyV1,
} from '../harness-v1.js';
import {
  redactProviderTextV1,
  requestProviderJsonV1,
  validateProviderBaseUrlV1,
  validateProviderLimitsV1,
  type ProviderHttpLimitsV1,
} from './provider-http-v1.js';

export interface AnthropicProviderConfigV1 extends ProviderHttpLimitsV1 {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  fetch?: typeof globalThis.fetch;
}

export function createAnthropicProviderV1(config: AnthropicProviderConfigV1): AgentModelProviderV1 {
  const baseUrl = validateProviderBaseUrlV1(config.baseUrl, 'Anthropic');
  const apiKey = config.apiKey;
  const model = config.model.trim();
  if (!apiKey) throw new Error('Anthropic apiKey is required');
  if (!model) throw new Error('Anthropic model is required');
  const maxTokens = config.maxTokens ?? 4096;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 65_536) {
    throw new Error('Anthropic maxTokens must be an integer between 1 and 65536');
  }
  const limits = validateProviderLimitsV1(config);
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    id: 'anthropic',
    redactSensitiveText: (value) => redactProviderTextV1(value, apiKey),
    async complete(input): Promise<AgentModelReplyV1> {
      const system = input.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
      const body = await requestProviderJsonV1({
        label: 'Anthropic', url: `${baseUrl}/messages`, secret: apiKey,
        fetch: fetchImpl, signal: input.signal, ...limits,
        init: {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model, max_tokens: maxTokens,
            ...(system ? { system } : {}),
            messages: input.messages.flatMap((message) => message.role === 'system' ? [] : [toAnthropicMessage(message)]),
            tools: input.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
          }),
        },
      }) as AnthropicMessagesResponse;
      if (!Array.isArray(body.content)) throw new Error('Anthropic response did not contain content');
      const texts: string[] = [];
      const toolCalls: NonNullable<AgentModelReplyV1['toolCalls']> = [];
      for (const block of body.content) {
        if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text);
        if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string'
          && isRecord(block.input)) {
          toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
        }
      }
      return {
        content: texts.join('\n'),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    },
  };
}

function toAnthropicMessage(message: Exclude<AgentMessageV1, { role: 'system' }>): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }] };
  }
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: [
        ...(message.content ? [{ type: 'text', text: message.content }] : []),
        ...(message.toolCalls ?? []).map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })),
      ],
    };
  }
  return { role: 'user', content: [{ type: 'text', text: message.content }] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface AnthropicMessagesResponse {
  content?: Array<{
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
}
