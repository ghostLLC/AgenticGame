import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executable = resolve(process.argv[2] ?? 'dist/agent-bridge/AgenticGame-Agent.exe');
const dataRoot = await mkdtemp(join(tmpdir(), 'agentic-game-agent-bridge-smoke-'));
const transport = new StdioClientTransport({
  command: executable,
  args: ['mcp'],
  env: { ...process.env, AGENTIC_GAME_USER_DATA: dataRoot },
  stderr: 'pipe',
});
const client = new Client({ name: 'agentic-game-agent-bridge-smoke', version: '1.0.0' });
const source = `module.exports = () => ({ onTick(view) { const seen = Boolean(view.visibleEnemies?.length); return { throttle: seen ? 0 : 1, bodyTurn: 0, turretTurn: seen ? 0 : 1, fire: seen }; } });`;

await client.connect(transport);
try {
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  const expected = [
    'get_game_context',
    'evaluate_bot',
    'get_player_workspace',
    'save_bot_revision',
    'run_practice_match',
    'list_battle_history',
  ];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`工具列表不匹配: ${JSON.stringify(names)}`);
  }

  for (const note of ['独立桥接验收首版', '独立桥接验收对手版']) {
    const saved = await client.callTool({
      name: 'save_bot_revision',
      arguments: {
        label: 'Agent Bridge 验收车',
        note,
        doctrine: 'medium',
        vehicleId: 'medium',
        weaponId: 'medium-cannon',
        source,
      },
    });
    if (saved.isError || saved.structuredContent?.evaluation?.verified !== true) {
      throw new Error(`保存并评测失败: ${JSON.stringify(saved)}`);
    }
  }

  const practice = await client.callTool({
    name: 'run_practice_match',
    arguments: { currentRevision: 2, opponentRevision: 1, modeId: 'capture', seed: 902 },
  });
  if (practice.isError || practice.structuredContent?.modeName !== '据点争夺') {
    throw new Error(`练习赛失败: ${JSON.stringify(practice)}`);
  }

  const history = await client.callTool({ name: 'list_battle_history', arguments: { limit: 10 } });
  if (history.isError || history.structuredContent?.count !== 1) {
    throw new Error(`历史记录失败: ${JSON.stringify(history)}`);
  }

  console.log(`Agent Bridge smoke passed: 6 tools, 2 revisions, 1 practice match (${executable})`);
} finally {
  await client.close();
}
