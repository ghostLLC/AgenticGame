import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createAgenticGameMcpServerV1 } from './mcp-server-v1.js';

export function startAgenticGameMcpStdioV1(): StdioServerHandle {
  return serveStdio(
    () => createAgenticGameMcpServerV1(),
    { onerror: (error) => process.stderr.write(`[agentic-game:mcp] ${error.message}\n`) },
  );
}
