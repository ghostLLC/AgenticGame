import type {
  AgentMessageV1,
  AgentModelProviderV1,
  AgentModelReplyV1,
  AgentModelRequestV1,
} from '../harness-v1.js';

export interface OpenAICompatibleProviderConfigV1 {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  fetch?: typeof globalThis.fetch;
}

export function createOpenAICompatibleProviderV1(
  config: OpenAICompatibleProviderConfigV1,
): AgentModelProviderV1 {
  const baseUrl = validateBaseUrl(config.baseUrl);
  const apiKey = config.apiKey;
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (!apiKey) throw new Error('OpenAI-compatible apiKey is required');
  if (!config.model.trim()) throw new Error('OpenAI-compatible model is required');
  const maxTokens = config.maxTokens ?? 4096;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 65_536) {
    throw new Error('OpenAI-compatible maxTokens must be an integer between 1 and 65536');
  }

  return {
    id: 'openai-compatible',
    redactSensitiveText: (value) => redact(value, apiKey),
    async complete(input): Promise<AgentModelReplyV1> {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
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
        signal: input.signal,
      });
      if (!response.ok) {
        const detail = redact((await response.text()).slice(0, 500), apiKey);
        throw new Error(`OpenAI-compatible request failed (${response.status}): ${detail}`);
      }
      const body = await response.json() as OpenAIChatCompletionResponse;
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

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('OpenAI-compatible baseUrl must be a valid URL');
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && loopbackHosts.has(url.hostname));
  if (!allowed) throw new Error('OpenAI-compatible baseUrl must use HTTPS or an explicit loopback host');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('OpenAI-compatible baseUrl cannot include credentials, query parameters, or fragments');
  }
  return url.toString().replace(/\/+$/, '');
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

function redact(value: string, secret: string): string {
  return secret ? value.split(secret).join('[REDACTED]') : value;
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
