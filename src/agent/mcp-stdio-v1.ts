import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAgenticGameMcpServerV1, type AgenticGameMcpServerOptionsV1 } from './mcp-server-v1.js';

export function startAgenticGameMcpStdioV1(options: AgenticGameMcpServerOptionsV1 = {}): StdioServerHandle {
  const dataRoot = options.dataRoot ?? defaultAgentDataRootV1();
  return serveStdio(
    () => createAgenticGameMcpServerV1({ ...options, dataRoot }),
    { onerror: (error) => process.stderr.write(`[agentic-game:mcp] ${error.message}\n`) },
  );
}

export function defaultAgentDataRootV1(): string {
  const override = process.env.AGENTIC_GAME_USER_DATA;
  if (override) return resolve(override);
  if (process.platform === 'win32' && process.env.APPDATA) return resolve(process.env.APPDATA, 'AgenticGame');
  return join(homedir(), '.agentic-game');
}
