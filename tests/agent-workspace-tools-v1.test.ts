import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentWorkspaceToolsV1 } from '../src/agent/workspace-tools-v1.js';

const SOURCE_V1 = `module.exports = () => ({ onTick(view) { return { throttle: 1, bodyTurn: 0, turretTurn: 1, fire: Boolean(view.visibleEnemies?.length) }; } });`;
const SOURCE_V2 = `module.exports = () => ({ onTick(view) { const seen = Boolean(view.visibleEnemies?.length); return { throttle: seen ? 0 : 1, bodyTurn: 0, turretTurn: seen ? 0 : 1, fire: seen }; } });`;

async function tools() {
  const dataRoot = await mkdtemp(join(tmpdir(), 'agentic-game-agent-workspace-'));
  const values = createAgentWorkspaceToolsV1({
    dataRoot,
    now: () => '2026-09-02T04:00:00.000Z',
  });
  return {
    dataRoot,
    tool: (name: string) => values.find((candidate) => candidate.name === name)!,
  };
}

describe('Agent workspace tools v1', () => {
  it('lets an external agent save immutable revisions and run a persisted practice match', async () => {
    const { tool } = await tools();

    const first = await tool('save_bot_revision').execute({
      label: 'Agent 侧翼手', note: '建立可工作的首版', doctrine: 'medium',
      vehicleId: 'medium', weaponId: 'medium-cannon', source: SOURCE_V1,
    }) as Record<string, unknown>;
    const second = await tool('save_bot_revision').execute({
      label: 'Agent 侧翼手', note: '发现目标后停车瞄准', doctrine: 'medium',
      vehicleId: 'medium', weaponId: 'medium-cannon', source: SOURCE_V2,
    }) as Record<string, unknown>;

    expect(first).toMatchObject({ created: true, revision: 1, evaluation: { verified: true } });
    expect(second).toMatchObject({ created: true, revision: 2, evaluation: { verified: true } });

    const workspace = await tool('get_player_workspace').execute({}) as Record<string, any>;
    expect(workspace).toMatchObject({
      status: 'ready',
      current: { revision: 2, label: 'Agent 侧翼手', source: SOURCE_V2 },
      revisions: [
        { revision: 1, label: 'Agent 侧翼手', note: '建立可工作的首版' },
        { revision: 2, label: 'Agent 侧翼手', note: '发现目标后停车瞄准' },
      ],
    });

    const battle = await tool('run_practice_match').execute({
      currentRevision: 2, opponentRevision: 1, modeId: 'capture', seed: 7,
    }) as Record<string, unknown>;
    expect(battle).toMatchObject({ currentRevision: 2, opponentRevision: 1, modeName: '据点争夺' });

    const history = await tool('list_battle_history').execute({ limit: 10 }) as Record<string, any>;
    expect(history.count).toBe(1);
    expect(history.battles[0]).toMatchObject({ source: 'practice', modeName: '据点争夺', integrity: 'verified' });
  }, 30_000);

  it('rejects an incompatible loadout without creating a revision', async () => {
    const { tool } = await tools();
    await expect(tool('save_bot_revision').execute({
      label: '错误装配', note: '', doctrine: 'scout',
      vehicleId: 'scout', weaponId: 'heavy-cannon', source: SOURCE_V1,
    })).rejects.toThrow('不兼容');
    expect(await tool('get_player_workspace').execute({})).toMatchObject({ status: 'empty', revisions: [] });
  });
});
