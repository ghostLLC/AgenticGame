import { describe, expect, it } from 'vitest';
import { createGameToolsV1 } from '../src/agent/game-tools-v1.js';

const idleBot = `
module.exports = function createTank() {
  return { name: 'Candidate', onTick() { return {}; } };
};`;

describe('AgenticGame tool registry v1', () => {
  it('describes current official gameplay content without exposing mutable internals', async () => {
    const tools = createGameToolsV1();
    const contextTool = tools.find((tool) => tool.name === 'get_game_context')!;
    const result = await contextTool.execute({});

    expect(result).toMatchObject({
      schemaVersion: 1,
      game: 'AgenticGame: Tank Arena',
      map: { id: 'frontier-v2', captureZones: 1 },
    });
    expect(result).toHaveProperty('modes');
    expect(JSON.stringify(result)).toContain('capture');
    expect(Object.isFrozen(result)).toBe(false);
  });

  it('evaluates submitted bot source in the real v2 sandbox and returns only a verified summary', async () => {
    const tools = createGameToolsV1({ createdAt: () => '2026-08-24T08:00:00.000Z' });
    const evaluate = tools.find((tool) => tool.name === 'evaluate_bot')!;
    const result = await evaluate.execute({
      source: idleBot,
      modeId: 'duel',
      vehicleId: 'medium',
      weaponId: 'medium-cannon',
      seed: 7,
      maxTicks: 8,
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      verified: true,
      opponent: 'baseline-sentry-v1',
      result: { ticks: 8 },
    });
    expect(result).toHaveProperty('bundleHash');
    expect(result).toHaveProperty('candidate');
    expect(result).not.toHaveProperty('bundle');
    expect(JSON.stringify(result)).not.toContain(idleBot);
  });
});
