import { describe, expect, it } from 'vitest';
import { GAMEPLAY_CONTENT_V2, GAMEPLAY_MAP_FRONTIER_V2 } from '../src/core/v2/gameplay-content.js';
import type { MatchConfigV2 } from '../src/core/v2/match-config.js';
import { verifyMatchBundleV2 } from '../src/replay/v2.js';
import { fullCodeHash } from '../src/runner/v2-adapter.js';
import { runMatchV2 } from '../src/runner/match-v2.js';

const observerBot = `
module.exports = function createTank() {
  return {
    name: 'Observer',
    onTick(view) {
      console.log('visible:' + view.visibleEnemies.length);
      return { throttle: 1, bodyTurn: 0, turretTurn: 0, fire: view.visibleEnemies.length > 0 };
    }
  };
};`;

const sentryBot = `
module.exports = function createTank() {
  return {
    name: 'Sentry',
    onTick(view) {
      console.log('visible:' + view.visibleEnemies.length);
      return { throttle: 0, bodyTurn: 0, turretTurn: 0, fire: view.visibleEnemies.length > 0 };
    }
  };
};`;

const idleBot = `
module.exports = function createTank(ctx) {
  return {
    name: 'Idle',
    onTick() {
      console.log('capture-zones:' + (ctx.captureZones ? ctx.captureZones.length : -1));
      return {};
    }
  };
};`;

function matchConfig(): MatchConfigV2 {
  return {
    schemaVersion: 2,
    matchId: 'sandboxed-gameplay-v2',
    ruleset: { id: 'gameplay-v2', version: '2.0.0' },
    modeId: 'duel',
    mapId: 'frontier-v2',
    seed: 20260824,
    maxTicks: 16,
    teams: [
      {
        teamId: 'team-a', displayName: 'Scout Team',
        bot: { artifactId: 'observer-bot', version: '1.0.0', codeHash: fullCodeHash(observerBot) },
        loadout: { vehicleId: 'scout', weaponIds: ['light-cannon'], equipmentIds: [] },
      },
      {
        teamId: 'team-b', displayName: 'Heavy Team',
        bot: { artifactId: 'sentry-bot', version: '1.0.0', codeHash: fullCodeHash(sentryBot) },
        loadout: { vehicleId: 'heavy', weaponIds: ['heavy-cannon'], equipmentIds: [] },
      },
    ],
  };
}

describe('runMatchV2', () => {
  it('runs filtered sandbox views into a complete verified deterministic bundle', async () => {
    const input = {
      matchConfig: matchConfig(),
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      bots: [
        { path: 'observer.js', code: observerBot },
        { path: 'sentry.js', code: sentryBot },
      ] as const,
      createdAt: '2026-08-24T00:00:00.000Z',
      tickBudgetMs: 100,
      collectLogs: true,
    };

    const first = await runMatchV2(input);
    const second = await runMatchV2(input);

    expect(second).toEqual(first);
    expect(first.summary).toMatchObject({ reason: 'max-ticks', ticks: 16 });
    expect(first.bundle.config).toEqual(input.matchConfig);
    expect(first.bundle.contentSnapshot).toEqual(GAMEPLAY_CONTENT_V2);
    expect(first.bundle.mapSnapshot).toEqual(GAMEPLAY_MAP_FRONTIER_V2);
    expect(first.bundle.actions.length).toBe(32);
    expect(first.bundle.actions.slice(0, 2).map((action) => action.actorId)).toEqual(['team-a', 'team-b']);
    expect(first.bundle.checkpoints).toHaveLength(17);
    expect(first.bundle.checkpoints[0]).toMatchObject({ tick: 0, state: { tick: 0 } });
    expect(first.bundle.logs.some((log) => log.sourceId === 'team-a' && log.message === 'visible:0')).toBe(true);
    expect(first.bundle.logs.some((log) => log.sourceId === 'team-b' && log.message === 'visible:0')).toBe(true);
    const firstState = first.bundle.checkpoints[1]!.state as Record<string, unknown>;
    expect(firstState).toHaveProperty('tanks');
    expect(JSON.stringify(firstState)).toContain('"ammunition":18');
    expect(JSON.stringify(firstState)).toContain('"velocityPermille":500');
    expect(verifyMatchBundleV2(first.bundle)).toEqual({ ok: true, issues: [] });
  });

  it('rejects Bot source that does not match the configured artifact hash', async () => {
    const bad = matchConfig();
    bad.teams[0]!.bot.codeHash = '0'.repeat(64);

    await expect(runMatchV2({
      matchConfig: bad,
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: GAMEPLAY_MAP_FRONTIER_V2,
      bots: [
        { path: 'observer.js', code: observerBot },
        { path: 'sentry.js', code: sentryBot },
      ],
      createdAt: '2026-08-24T00:00:00.000Z',
    })).rejects.toThrow('Bot source hash mismatch: team-a');
  });

  it('runs capture mode through the real sandbox and records objective events in the verified bundle', async () => {
    const captureConfig = matchConfig();
    const codeHash = fullCodeHash(idleBot);
    captureConfig.modeId = 'capture';
    captureConfig.maxTicks = 40;
    for (const team of captureConfig.teams) {
      team.bot = { artifactId: 'idle-bot', version: '1.0.0', codeHash };
    }
    const captureMap = structuredClone(GAMEPLAY_MAP_FRONTIER_V2);
    captureMap.captureZones = [{ id: 'west-spawn-zone', x: 5, y: 12, width: 1, height: 1 }];

    const output = await runMatchV2({
      matchConfig: captureConfig,
      contentSnapshot: GAMEPLAY_CONTENT_V2,
      mapSnapshot: captureMap,
      bots: [{ code: idleBot }, { code: idleBot }],
      createdAt: '2026-08-24T06:00:00.000Z',
      tickBudgetMs: 100,
    });

    expect(output.summary).toMatchObject({
      winningTeamIds: ['team-a'], reason: 'captured', ticks: 30,
    });
    expect(output.bundle.events.filter((event) => event.type === 'capture-progress')).toHaveLength(30);
    expect(output.bundle.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tick: 29,
        type: 'capture-progress',
        payload: { zoneId: 'west-spawn-zone', teamId: 'team-a', progress: 30, required: 30 },
      }),
      expect.objectContaining({
        tick: 29,
        type: 'match-ended',
        payload: { winningTeamIds: ['team-a'], reason: 'captured' },
      }),
    ]));
    expect(output.bundle.checkpoints).toHaveLength(31);
    expect(output.bundle.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'team-a', message: 'capture-zones:1' }),
      expect.objectContaining({ sourceId: 'team-b', message: 'capture-zones:1' }),
    ]));
    expect(verifyMatchBundleV2(output.bundle)).toEqual({ ok: true, issues: [] });
  });
});
