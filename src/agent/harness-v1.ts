export type AgentToolInputV1 = Record<string, unknown>;
export type AgentToolOutputV1 = Record<string, unknown> | unknown[] | string | number | boolean | null;

export interface AgentToolV1 {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  execute(input: AgentToolInputV1, context?: { signal?: AbortSignal }): Promise<AgentToolOutputV1>;
}

export interface AgentToolCallV1 {
  id: string;
  name: string;
  arguments: AgentToolInputV1;
}

export type AgentMessageV1 =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AgentToolCallV1[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

export interface AgentModelRequestV1 {
  messages: readonly AgentMessageV1[];
  tools: readonly AgentToolV1[];
  signal?: AbortSignal;
}

export interface AgentModelReplyV1 {
  content?: string;
  toolCalls?: AgentToolCallV1[];
}

export interface AgentModelProviderV1 {
  id: string;
  complete(input: AgentModelRequestV1): Promise<AgentModelReplyV1>;
  redactSensitiveText?(value: string): string;
}

export interface AgentHarnessLimitsV1 {
  maxTurns: number;
  maxToolCalls: number;
}

export interface RunAgentHarnessInputV1 {
  provider: AgentModelProviderV1;
  tools: readonly AgentToolV1[];
  systemPrompt: string;
  userPrompt: string;
  limits?: Partial<AgentHarnessLimitsV1>;
  signal?: AbortSignal;
}

export interface AgentHarnessResultV1 {
  status: 'completed' | 'limit-reached';
  output: string;
  stopReason: 'completed' | 'max-turns' | 'max-tool-calls';
  usage: { turns: number; toolCalls: number };
  transcript: AgentMessageV1[];
}

const DEFAULT_LIMITS: AgentHarnessLimitsV1 = { maxTurns: 8, maxToolCalls: 12 };

export async function runAgentHarnessV1(input: RunAgentHarnessInputV1): Promise<AgentHarnessResultV1> {
  const limits = validateLimits({ ...DEFAULT_LIMITS, ...input.limits });
  const toolMap = new Map(input.tools.map((tool) => [tool.name, tool]));
  if (toolMap.size !== input.tools.length) throw new Error('Agent tools must have unique names');
  const messages: AgentMessageV1[] = [
    { role: 'system', content: input.systemPrompt },
    { role: 'user', content: input.userPrompt },
  ];
  let turns = 0;
  let toolCalls = 0;

  while (turns < limits.maxTurns) {
    throwIfAborted(input.signal);
    const reply = await input.provider.complete({ messages, tools: input.tools, signal: input.signal });
    turns += 1;
    const calls = reply.toolCalls ?? [];
    messages.push({ role: 'assistant', content: reply.content ?? '', ...(calls.length > 0 ? { toolCalls: calls } : {}) });
    if (calls.length === 0) {
      return redactResult({
        status: 'completed', output: reply.content ?? '', stopReason: 'completed',
        usage: { turns, toolCalls }, transcript: messages,
      }, input.provider.redactSensitiveText);
    }

    for (const call of calls) {
      const tool = toolMap.get(call.name);
      if (!tool) {
        messages.push({
          role: 'tool', toolCallId: call.id, name: call.name,
          content: JSON.stringify({ error: 'tool_not_allowed', allowedTools: [...toolMap.keys()] }),
        });
        continue;
      }
      if (toolCalls >= limits.maxToolCalls) {
        return redactResult({
          status: 'limit-reached', output: '', stopReason: 'max-tool-calls',
          usage: { turns, toolCalls }, transcript: messages,
        }, input.provider.redactSensitiveText);
      }
      throwIfAborted(input.signal);
      toolCalls += 1;
      try {
        const result = await tool.execute(call.arguments, { signal: input.signal });
        throwIfAborted(input.signal);
        messages.push({
          role: 'tool', toolCallId: call.id, name: call.name,
          content: JSON.stringify(result),
        });
      } catch (error) {
        throwIfAborted(input.signal);
        messages.push({
          role: 'tool', toolCallId: call.id, name: call.name,
          content: JSON.stringify({ error: 'tool_execution_failed', message: safeErrorMessage(error) }),
        });
      }
    }
  }

  return redactResult({
    status: 'limit-reached', output: '', stopReason: 'max-turns',
    usage: { turns, toolCalls }, transcript: messages,
  }, input.provider.redactSensitiveText);
}

function validateLimits(limits: AgentHarnessLimitsV1): AgentHarnessLimitsV1 {
  if (!Number.isInteger(limits.maxTurns) || limits.maxTurns < 1 || limits.maxTurns > 100) {
    throw new Error('maxTurns must be an integer between 1 and 100');
  }
  if (!Number.isInteger(limits.maxToolCalls) || limits.maxToolCalls < 0 || limits.maxToolCalls > 1000) {
    throw new Error('maxToolCalls must be an integer between 0 and 1000');
  }
  return limits;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Agent run aborted');
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

function redactResult(
  result: AgentHarnessResultV1,
  redactSensitiveText?: (value: string) => string,
): AgentHarnessResultV1 {
  if (!redactSensitiveText) return result;
  return JSON.parse(redactSensitiveText(JSON.stringify(result))) as AgentHarnessResultV1;
}
