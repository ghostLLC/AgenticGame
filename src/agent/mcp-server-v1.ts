import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import { createGameToolsV1, type GameToolsOptionsV1 } from './game-tools-v1.js';

export function createAgenticGameMcpServerV1(options: GameToolsOptionsV1 = {}): McpServer {
  const server = new McpServer(
    { name: 'agentic-game', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  for (const tool of createGameToolsV1(options)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const result = await tool.execute(input);
          const structuredContent = toStructuredContent(result);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent,
          };
        } catch (error) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'tool_execution_failed',
                message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
              }),
            }],
          };
        }
      },
    );
  }

  return server;
}

function toStructuredContent(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}
