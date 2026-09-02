import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgenticGameMcpServerV1 } from '../src/agent/mcp-server-v1.js';

describe('AgenticGame MCP server v1', () => {
  it('lists and invokes the shared game tools through the MCP protocol', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agentic-game-mcp-'));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createAgenticGameMcpServerV1({ dataRoot });
    const client = new Client({ name: 'agentic-game-test', version: '1.0.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        'get_game_context', 'evaluate_bot', 'get_player_workspace',
        'save_bot_revision', 'run_practice_match', 'list_battle_history',
      ]);
      expect(listed.tools.find((tool) => tool.name === 'evaluate_bot')?.inputSchema)
        .toMatchObject({ type: 'object', required: ['source'] });

      const called = await client.callTool({ name: 'get_game_context', arguments: {} });
      expect(called.isError).not.toBe(true);
      expect(called.structuredContent).toMatchObject({
        schemaVersion: 1,
        game: 'AgenticGame: Tank Arena',
      });
      expect(listed.tools.find((tool) => tool.name === 'save_bot_revision')?.annotations)
        .toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('serves the same tools from the real arena mcp stdio process', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'agentic-game-mcp-stdio-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/cli/index.ts'), 'mcp'],
      cwd: process.cwd(),
      env: { ...process.env, AGENTIC_GAME_USER_DATA: dataRoot },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'agentic-game-stdio-test', version: '1.0.0' });

    await client.connect(transport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        'get_game_context', 'evaluate_bot', 'get_player_workspace',
        'save_bot_revision', 'run_practice_match', 'list_battle_history',
      ]);
      const called = await client.callTool({ name: 'get_game_context', arguments: {} });
      expect(called.structuredContent).toMatchObject({ map: { id: 'frontier-v2' } });
    } finally {
      await client.close();
    }
  }, 15_000);
});
