import type {
  AgentMessageV1,
  AgentModelProviderV1,
  AgentModelReplyV1,
  AgentModelRequestV1,
} from '../harness-v1.js';
import {
  redactProviderTextV1,
  requestProviderJsonV1,
  validateProviderBaseUrlV1,
  validateProviderLimitsV1,
  type ProviderHttpLimitsV1,
} from './provider-http-v1.js';

export interface OpenAICompatibleProviderConfigV1 extends ProviderHttpLimitsV1 {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  fetch?: typeof globalThis.fetch;
}

export function createOpenAICompatibleProviderV1(
  config: OpenAICompatibleProviderConfigV1,
): AgentModelProviderV1 {
  const baseUrl = validateProviderBaseUrlV1(config.baseUrl, 'OpenAI-compatible');
  const apiKey = config.apiKey;
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (!apiKey) throw new Error('OpenAI-compatible apiKey is required');
  if (!config.model.trim()) throw new Error('OpenAI-compatible model is required');
  const limits = validateProviderLimitsV1(config);
  const maxTokens = config.maxTokens ?? 4096;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 65_536) {
    throw new Error('OpenAI-compatible maxTokens must be an integer between 1 and 65536');
  }

  return {
    id: 'openai-compatible',
    redactSensitiveText: (value) => redactProviderTextV1(value, apiKey),
    async complete(input): Promise<AgentModelReplyV1> {
      const body = await requestProviderJsonV1({
        label: 'OpenAI-compatible', url: `${baseUrl}/chat/completions`, secret: apiKey,
        fetch: fetchImpl, signal: input.signal, ...limits,
        init: {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: config.model,
            max_tokens: maxTokens,
            messages: input.messages.map(toOpenAIMessage),
            tools: input.tools.map((tool) => ({
              type: 'function',
              function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
            })),
            tool_choice: input.tools.length > 0 ? 'auto' : undefined,
          }),
        },
      }) as OpenAIChatCompletionResponse;
      const message = body.choices?.[0]?.message;
      if (!message) throw new Error('OpenAI-compatible response did not contain a message');
      return {
        content: message.content ?? '',
        ...(message.tool_calls?.length
          ? { toolCalls: message.tool_calls.map((call) => ({
              id: call.id,
              name: call.function.name,
              arguments: parseArguments(call.function.arguments),
            })) }
          : {}),
      };
    },
  };
}

function toOpenAIMessage(message: AgentMessageV1): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant', content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id, type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('tool arguments must be an object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`OpenAI-compatible tool arguments were invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
}
