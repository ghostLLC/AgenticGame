import { describe, expect, it } from 'vitest';
import { GAMEPLAY_CONTENT_V2, GAMEPLAY_MAP_FRONTIER_V2 } from '../src/core/v2/gameplay-content.js';
import type { MatchConfigV2 } from '../src/core/v2/match-config.js';
import { createReplayStudioViewV2, seekReplayCheckpointV2 } from '../src/replay/studio-v2.js';
import { runMatchV2 } from '../src/runner/match-v2.js';
import { fullCodeHash } from '../src/runner/v2-adapter.js';

const idleBot = `module.exports = () => ({ name: 'Idle', onTick() { return {}; } });`;

function config(): MatchConfigV2 {
  const codeHash = fullCodeHash(idleBot);
  return {
    schemaVersion: 2,
    matchId: 'studio-view-v2',
    ruleset: { id: 'gameplay-v2', version: '2.0.0' },
    modeId: 'duel',
    mapId: GAMEPLAY_MAP_FRONTIER_V2.id,
    seed: 99,
    maxTicks: 3,
    teams: [
      {
        teamId: 'current', displayName: 'Revision 12',
        bot: { artifactId: 'idle', version: '1.0.0', codeHash },
        loadout: { vehicleId: 'scout', weaponIds: ['light-cannon'], equipmentIds: [] },
      },
      {
        teamId: 'historical', displayName: 'Revision 11',
        bot: { artifactId: 'idle', version: '1.0.0', codeHash },
        loadout: { vehicleId: 'scout', weaponIds: ['light-cannon'], equipmentIds: [] },
      },
    ],
  };
}

describe('Replay Studio v2 projection', () => {
  it('creates a player-facing overview without exposing embedded source or hashes', async () => {
    const output = await runMatchV2({
      matchConfig: config(),
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      bots: [{ code: idleBot }, { code: idleBot }],
      createdAt: '2026-08-24T05:00:00.000Z',
      tickBudgetMs: 100,
    });

    const view = createReplayStudioViewV2(output.bundle);
    expect(view).toMatchObject({
      matchId: 'studio-view-v2',
      modeName: '歼灭决斗',
      mapId: 'frontier-v2',
      result: { reason: 'max-ticks', ticks: 3 },
      participants: [
        { teamId: 'current', displayName: 'Revision 12', vehicleName: '侦察坦克', weaponName: '轻型炮' },
        { teamId: 'historical', displayName: 'Revision 11', vehicleName: '侦察坦克', weaponName: '轻型炮' },
      ],
    });
    expect(view.moments[0]).toMatchObject({ tick: 0, kind: 'start', title: '比赛开始' });
    expect(view.moments.at(-1)).toMatchObject({ tick: 3, kind: 'result', title: '比赛结束' });
    expect(JSON.stringify(view)).not.toContain('module.exports');
    expect(JSON.stringify(view)).not.toMatch(/[0-9a-f]{64}/);
  });

  it('seeks to the latest verified checkpoint at or before the requested tick', async () => {
    const output = await runMatchV2({
      matchConfig: config(),
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      bots: [{ code: idleBot }, { code: idleBot }],
      createdAt: '2026-08-24T05:00:00.000Z',
      tickBudgetMs: 100,
    });

    expect(seekReplayCheckpointV2(output.bundle, 0)).toMatchObject({ tick: 0, state: { tick: 0 } });
    expect(seekReplayCheckpointV2(output.bundle, 2)).toMatchObject({ tick: 2, state: { tick: 2 } });
    expect(() => seekReplayCheckpointV2(output.bundle, -1)).toThrow('Invalid replay tick');
  });

  it('refuses to project a bundle whose integrity no longer verifies', async () => {
    const output = await runMatchV2({
      matchConfig: config(),
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      bots: [{ code: idleBot }, { code: idleBot }],
      createdAt: '2026-08-24T05:00:00.000Z',
      tickBudgetMs: 100,
    });
    output.bundle.result.reason = 'tampered';

    expect(() => createReplayStudioViewV2(output.bundle)).toThrow('Replay integrity verification failed');
  });
});
