import { describe, expect, it } from 'vitest';
import type {
  BotArtifactSnapshotV2,
  ContentSnapshotV2,
  MapSnapshotV2,
} from '../src/core/v2/content.js';
import type { MatchConfigV2 } from '../src/core/v2/match-config.js';
import {
  createMatchBundleV2,
  verifyMatchBundleV2,
  type MatchBundleInputV2,
} from '../src/replay/v2.js';

const BLUE_HASH = 'd6ae068f60ac2ddd7f7893dcc723b3b11bf533de8852fc84353b27910ee1389c';
const RED_HASH = 'a909e6d7e41ab6bd86aa88b705b56f945d3e66afc06303f03c09064e78947eaf';

function configFixture(): MatchConfigV2 {
  return {
    schemaVersion: 2,
    matchId: 'bundle-test',
    ruleset: { id: 'core-rules', version: '2.0.0-alpha.1' },
    modeId: 'duel',
    mapId: 'tiny-map',
    seed: 7,
    maxTicks: 10,
    teams: [
      {
        teamId: 'blue',
        displayName: 'Blue',
        bot: { artifactId: 'bot-blue', version: '1.0.0', codeHash: BLUE_HASH },
        loadout: { vehicleId: 'medium-mk1', weaponIds: ['cannon-75'], equipmentIds: [] },
      },
      {
        teamId: 'red',
        displayName: 'Red',
        bot: { artifactId: 'bot-red', version: '1.0.0', codeHash: RED_HASH },
        loadout: { vehicleId: 'medium-mk1', weaponIds: ['cannon-75'], equipmentIds: [] },
      },
    ],
  };
}

function contentFixture(): ContentSnapshotV2 {
  return {
    vehicles: [{
      id: 'medium-mk1',
      displayName: 'Medium Mk. I',
      role: 'medium',
      maxHp: 100,
      armor: { front: 80, side: 50, rear: 30 },
      mobility: {
        maxSpeedPermille: 1000,
        accelerationPermillePerTick: 250,
        decelerationPermillePerTick: 300,
        bodyTurnTicks: 2,
        turretTurnTicks: 1,
      },
      vision: { rangeCells: 12 },
      compatibleWeaponIds: ['cannon-75'],
      compatibleEquipmentIds: [],
    }],
    weapons: [{
      id: 'cannon-75',
      displayName: '75 mm Cannon',
      damage: 34,
      penetration: 70,
      rangeCells: 16,
      reloadTicks: 4,
      projectileSpeedCellsPerTick: 2,
      ammunitionCapacity: 20,
    }],
    terrains: [{
      id: 'grass',
      displayName: 'Grass',
      movementCostPermille: 1000,
      visibilityModifierPermille: 1000,
      blocksMovement: false,
      blocksVision: false,
      blocksProjectiles: false,
    }],
    modes: [{
      id: 'duel',
      displayName: 'Duel',
      minTeams: 2,
      maxTeams: 2,
      victory: { type: 'last-team-standing' },
    }],
  };
}

function mapFixture(): MapSnapshotV2 {
  return {
    id: 'tiny-map',
    version: '1.0.0',
    width: 2,
    height: 1,
    terrainCells: [
      { x: 0, y: 0, terrainId: 'grass' },
      { x: 1, y: 0, terrainId: 'grass' },
    ],
    spawnPoints: [
      { id: 'spawn-blue', teamId: 'blue', x: 0, y: 0, bodyDirection: 2, turretDirection: 2 },
      { id: 'spawn-red', teamId: 'red', x: 1, y: 0, bodyDirection: 6, turretDirection: 6 },
    ],
  };
}

function botFixtures(): BotArtifactSnapshotV2[] {
  return [
    {
      artifactId: 'bot-blue',
      version: '1.0.0',
      codeHash: BLUE_HASH,
      language: 'javascript',
      entryPoint: 'index.js',
      source: 'blue-source',
    },
    {
      artifactId: 'bot-red',
      version: '1.0.0',
      codeHash: RED_HASH,
      language: 'javascript',
      entryPoint: 'index.js',
      source: 'red-source',
    },
  ];
}

function inputFixture(): MatchBundleInputV2 {
  return {
    engineVersion: '0.2.0-alpha.1',
    createdAt: '2026-08-24T00:00:00.000Z',
    config: configFixture(),
    mapSnapshot: mapFixture(),
    contentSnapshot: contentFixture(),
    botArtifacts: botFixtures(),
    actions: [
      { tick: 0, actorId: 'blue-tank', action: { throttle: 1 } },
      { tick: 0, actorId: 'red-tank', action: { throttle: 0 } },
    ],
    events: [{ tick: 0, type: 'match-started', payload: { seed: 7 } }],
    checkpoints: [{ tick: 0, state: { blueHp: 100, redHp: 100 } }],
    logs: [{ tick: 0, sourceId: 'bot-blue', level: 'info', message: 'advance' }],
    result: { winningTeamIds: ['blue'], reason: 'destroyed', ticks: 1 },
  };
}

describe('MatchBundleV2', () => {
  it('creates a self-contained bundle whose integrity verifies', () => {
    const bundle = createMatchBundleV2(inputFixture());

    expect(bundle).toMatchObject({
      format: 'agentic-game-match-bundle',
      version: 2,
      config: { matchId: 'bundle-test' },
      mapSnapshot: { id: 'tiny-map' },
      contentSnapshot: { vehicles: [{ id: 'medium-mk1' }] },
      botArtifacts: expect.arrayContaining([
        expect.objectContaining({ artifactId: 'bot-blue', source: 'blue-source' }),
      ]),
    });
    expect(bundle.checkpoints[0]?.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.values(bundle.integrity)).toHaveLength(5);
    expect(Object.values(bundle.integrity).every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(verifyMatchBundleV2(bundle)).toEqual({ ok: true, issues: [] });
  });

  it('detects action timeline tampering', () => {
    const bundle = createMatchBundleV2(inputFixture());
    bundle.actions[0]!.action.throttle = 0;

    const result = verifyMatchBundleV2(bundle);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['timeline_hash_mismatch', 'bundle_hash_mismatch']),
    );
  });

  it('detects map snapshot tampering', () => {
    const bundle = createMatchBundleV2(inputFixture());
    bundle.mapSnapshot.width = 3;

    const result = verifyMatchBundleV2(bundle);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['map_hash_mismatch', 'bundle_hash_mismatch']),
    );
  });

  it('detects checkpoint state tampering independently of timeline integrity', () => {
    const bundle = createMatchBundleV2(inputFixture());
    bundle.checkpoints[0]!.state.blueHp = 1;

    const result = verifyMatchBundleV2(bundle);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('checkpoint_hash_mismatch');
  });

  it('rejects a supplied checkpoint hash that does not match its state', () => {
    const input = inputFixture();
    input.checkpoints[0]!.stateHash = '0'.repeat(64);
    expect(() => createMatchBundleV2(input)).toThrow('checkpoint_hash_mismatch');
  });

  it('rejects a Bot artifact whose embedded source does not match its hash', () => {
    const input = inputFixture();
    input.botArtifacts[0]!.source = 'tampered-source';
    expect(() => createMatchBundleV2(input)).toThrow('artifact_hash_mismatch');
  });

  it.each(['actions', 'events', 'checkpoints', 'logs'] as const)(
    'rejects decreasing ticks in %s',
    (field) => {
      const input = inputFixture();
      const later = structuredClone(input[field][0]!);
      later.tick = 1;
      input[field] = [later, structuredClone(input[field][0]!)] as never;
      expect(() => createMatchBundleV2(input)).toThrow(`${field}_tick_order`);
    },
  );

  it('rejects invalid timestamps, ticks, and persisted actor IDs', () => {
    const timestamp = inputFixture();
    timestamp.createdAt = 'not-a-date';
    expect(() => createMatchBundleV2(timestamp)).toThrow('invalid_created_at');

    const tick = inputFixture();
    tick.actions[0]!.tick = -1;
    expect(() => createMatchBundleV2(tick)).toThrow('invalid_tick');

    const actor = inputFixture();
    actor.actions[0]!.actorId = 'Blue Tank';
    expect(() => createMatchBundleV2(actor)).toThrow('invalid_actor_id');
  });
});
