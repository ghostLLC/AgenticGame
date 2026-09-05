import { describe, expect, it } from 'vitest';
import type { ContentSnapshotV2, MapSnapshotV2, TerrainCellV2 } from '../src/core/v2/content.js';
import { GAMEPLAY_CONTENT_V2 } from '../src/core/v2/gameplay-content.js';
import { GameplayEngineV2 } from '../src/core/v2/gameplay-engine.js';
import type { MatchConfigV2 } from '../src/core/v2/match-config.js';
import type { TankAction } from '../src/core/types.js';
import { IDLE_ACTION } from '../src/core/types.js';

const idle: TankAction = { ...IDLE_ACTION };
const act = (partial: Partial<TankAction>): TankAction => ({ ...IDLE_ACTION, ...partial });

function config(vehicleA = 'scout', vehicleB = 'heavy', maxTicks = 100, modeId = 'duel'): MatchConfigV2 {
  const weaponFor: Record<string, string> = {
    scout: 'light-cannon', medium: 'medium-cannon', heavy: 'heavy-cannon', missing: 'light-cannon',
  };
  return {
    schemaVersion: 2,
    matchId: 'gameplay-engine-test',
    ruleset: { id: 'gameplay-v2', version: '2.0.0' },
    modeId,
    mapId: 'test-map',
    seed: 1,
    maxTicks,
    teams: [
      {
        teamId: 'team-a', displayName: 'Alpha',
        bot: { artifactId: 'bot-a', version: '1.0.0', codeHash: 'a'.repeat(64) },
        loadout: { vehicleId: vehicleA, weaponIds: [weaponFor[vehicleA]!], equipmentIds: [] },
      },
      {
        teamId: 'team-b', displayName: 'Bravo',
        bot: { artifactId: 'bot-b', version: '1.0.0', codeHash: 'b'.repeat(64) },
        loadout: { vehicleId: vehicleB, weaponIds: [weaponFor[vehicleB]!], equipmentIds: [] },
      },
    ],
  };
}

function mapFixture(
  spawns: MapSnapshotV2['spawnPoints'] = [
    { id: 'a', x: 1, y: 1, bodyDirection: 2, turretDirection: 2 },
    { id: 'b', x: 10, y: 10, bodyDirection: 6, turretDirection: 6 },
  ],
  overrides: TerrainCellV2[] = [],
): MapSnapshotV2 {
  const keyed = new Map(overrides.map((cell) => [`${cell.x},${cell.y}`, cell.terrainId]));
  const terrainCells = Array.from({ length: 12 }, (_, y) =>
    Array.from({ length: 12 }, (_, x) => ({ x, y, terrainId: keyed.get(`${x},${y}`) ?? 'open-ground' })),
  ).flat();
  return { id: 'test-map', version: '1.0.0', width: 12, height: 12, terrainCells, spawnPoints: spawns };
}

function contentFixture(): ContentSnapshotV2 {
  return structuredClone(GAMEPLAY_CONTENT_V2);
}

function captureContent(captureTicks = 3): ContentSnapshotV2 {
  const content = contentFixture();
  return {
    ...content,
    modes: [
      ...content.modes,
      {
        id: 'capture-test',
        displayName: '占领测试',
        minTeams: 2,
        maxTeams: 2,
        victory: { kind: 'capture-or-elimination', captureTicks },
      },
    ],
  };
}

function captureMap(
  spawns: MapSnapshotV2['spawnPoints'],
  zone = { id: 'center', x: 1, y: 1, width: 1, height: 1 },
): MapSnapshotV2 {
  return Object.assign(mapFixture(spawns), { captureZones: [zone] });
}

describe('GameplayEngineV2 creation and mobility', () => {
  it('blocks both contenders for a shared cell in 2.1, while retaining the 2.0 result', () => {
    const map = mapFixture([
      { id: 'a', x: 2, y: 2, bodyDirection: 2, turretDirection: 2 },
      { id: 'b', x: 4, y: 2, bodyDirection: 6, turretDirection: 6 },
    ]);
    const configNew = config('scout', 'scout'); configNew.ruleset.version = '2.1.0';
    const modern = new GameplayEngineV2(configNew, contentFixture(), map);
    const legacy = new GameplayEngineV2(config('scout', 'scout'), contentFixture(), map);
    for (const engine of [modern, legacy]) {
      engine.state.tanks.forEach((tank) => { tank.velocityPermille = 1000; });
      engine.step([act({ throttle: 1 }), act({ throttle: 1 })]);
    }
    expect(modern.state.tanks.map((tank) => tank.x)).toEqual([2, 4]);
    expect(legacy.state.tanks.map((tank) => tank.x)).toEqual([3, 4]);
    const reverseConfig = structuredClone(configNew); reverseConfig.teams.reverse();
    const reverseMap = structuredClone(map); reverseMap.spawnPoints.reverse();
    const reversed = new GameplayEngineV2(reverseConfig, contentFixture(), reverseMap);
    reversed.state.tanks.forEach((tank) => { tank.velocityPermille = 1000; });
    reversed.step([act({ throttle: 1 }), act({ throttle: 1 })]);
    expect(reversed.state.tanks.map((tank) => tank.x)).toEqual([4, 2]);
  });

  it('draws a 2.1 duel at the time limit even when starting hull durability differs', () => {
    const current = config('scout', 'heavy', 1); current.ruleset.version = '2.1.0';
    const engine = new GameplayEngineV2(current, contentFixture(), mapFixture());
    engine.step([idle, idle]);
    expect(engine.state.winningTeamIds).toEqual([]);
    expect(engine.state.endReason).toBe('time-limit-draw');
  });
  it('rejects a loadout whose vehicle is absent from the content snapshot', () => {
    expect(() => new GameplayEngineV2(config('missing'), contentFixture(), mapFixture()))
      .toThrow('未知车辆引用: missing');
  });

  it('makes the scout move sooner than the heavy under identical throttle', () => {
    const engine = new GameplayEngineV2(config('scout', 'heavy'), contentFixture(), mapFixture());

    engine.step([act({ throttle: 1 }), act({ throttle: 1 })]);
    engine.step([act({ throttle: 1 }), act({ throttle: 1 })]);

    expect(engine.state.tanks[0]).toMatchObject({ x: 2, y: 1, velocityPermille: 1000 });
    expect(engine.state.tanks[1]).toMatchObject({ x: 10, y: 10, velocityPermille: 500 });
  });

  it('requires more accumulated movement to enter mud than open ground', () => {
    const map = mapFixture(undefined, [{ x: 9, y: 10, terrainId: 'mud' }]);
    const engine = new GameplayEngineV2(config('medium', 'medium'), contentFixture(), map);

    engine.step([act({ throttle: 1 }), act({ throttle: 1 })]);
    engine.step([act({ throttle: 1 }), act({ throttle: 1 })]);

    expect(engine.state.tanks[0]).toMatchObject({ x: 2, y: 1 });
    expect(engine.state.tanks[1]).toMatchObject({ x: 10, y: 10, movementProgressPermille: 1200 });
  });

  it('enforces the heavy two-tick body turn cadence while the scout turns every tick', () => {
    const engine = new GameplayEngineV2(config('scout', 'heavy'), contentFixture(), mapFixture());

    engine.step([act({ bodyTurn: 1 }), act({ bodyTurn: 1 })]);
    engine.step([act({ bodyTurn: 1 }), act({ bodyTurn: 1 })]);

    expect(engine.state.tanks[0].bodyDirection).toBe(4);
    expect(engine.state.tanks[1].bodyDirection).toBe(7);
  });
});

describe('GameplayEngineV2 fog of war', () => {
  const sightSpawns: MapSnapshotV2['spawnPoints'] = [
    { id: 'a', x: 1, y: 1, bodyDirection: 2, turretDirection: 2 },
    { id: 'b', x: 9, y: 1, bodyDirection: 6, turretDirection: 6 },
  ];

  it('shows an open target inside effective vision range', () => {
    const engine = new GameplayEngineV2(config('scout', 'heavy'), contentFixture(), mapFixture(sightSpawns));

    expect(engine.viewFor(0).visibleEnemies.map((tank) => tank.teamId)).toEqual(['team-b']);
  });

  it('hides the same target when forest reduces its effective detection range', () => {
    const engine = new GameplayEngineV2(
      config('scout', 'heavy'),
      contentFixture(),
      mapFixture(sightSpawns, [{ x: 9, y: 1, terrainId: 'forest' }]),
    );

    expect(engine.viewFor(0).visibleEnemies).toEqual([]);
  });

  it('does not leak an enemy through vision-blocking terrain', () => {
    const engine = new GameplayEngineV2(
      config('scout', 'heavy'),
      contentFixture(),
      mapFixture(sightSpawns, [{ x: 5, y: 1, terrainId: 'wall' }]),
    );

    expect(engine.viewFor(0).visibleEnemies).toEqual([]);
  });
});

describe('GameplayEngineV2 weapons and directional armor', () => {
  const combatSpawns = (targetDirection: 0 | 2 | 6): MapSnapshotV2['spawnPoints'] => [
    { id: 'a', x: 1, y: 5, bodyDirection: 2, turretDirection: 2 },
    { id: 'b', x: 5, y: 5, bodyDirection: targetDirection, turretDirection: 6 },
  ];

  function lightHit(targetDirection: 0 | 2 | 6) {
    const engine = new GameplayEngineV2(
      config('scout', 'heavy'), contentFixture(), mapFixture(combatSpawns(targetDirection)),
    );
    engine.step([act({ fire: true }), idle]);
    engine.step([idle, idle]);
    const events = engine.step([idle, idle]);
    return { engine, hit: events.find((event) => event.type === 'hit') };
  }

  it('makes front, side, and rear armor produce distinct explained damage', () => {
    const front = lightHit(6);
    const side = lightHit(0);
    const rear = lightHit(2);

    expect(front.hit).toMatchObject({ impactZone: 'front', armor: 55, penetration: 18, damage: 1 });
    expect(side.hit).toMatchObject({ impactZone: 'side', armor: 32, penetration: 18, damage: 10 });
    expect(rear.hit).toMatchObject({ impactZone: 'rear', armor: 18, penetration: 18, damage: 24 });
    expect([front.engine.state.tanks[1].hp, side.engine.state.tanks[1].hp, rear.engine.state.tanks[1].hp])
      .toEqual([149, 140, 126]);
  });

  it('consumes finite ammunition, respects reload, reports dry fire, and expires at range', () => {
    const content = contentFixture();
    const light = content.weapons.find((weapon) => weapon.id === 'light-cannon')!;
    Object.assign(light, { ammunitionCapacity: 1, reloadTicks: 2, rangeCells: 3 });
    const spawns: MapSnapshotV2['spawnPoints'] = [
      { id: 'a', x: 1, y: 2, bodyDirection: 2, turretDirection: 2 },
      { id: 'b', x: 10, y: 10, bodyDirection: 6, turretDirection: 6 },
    ];
    const engine = new GameplayEngineV2(config('scout', 'heavy'), content, mapFixture(spawns));

    const fired = engine.step([act({ fire: true }), idle]);
    const reloading = engine.step([act({ fire: true }), idle]);
    const empty = engine.step([act({ fire: true }), idle]);

    expect(fired.filter((event) => event.type === 'fire')).toHaveLength(1);
    expect(reloading.some((event) => event.type === 'fire' || event.type === 'dry-fire')).toBe(false);
    expect(empty).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'projectile-expired', teamId: 'team-a' }),
      expect.objectContaining({ type: 'dry-fire', teamId: 'team-a' }),
    ]));
    expect(engine.state.tanks[0]).toMatchObject({ ammunition: 0, reloadTicksRemaining: 0 });
    expect(engine.state.projectiles).toEqual([]);
  });

  it('ends the duel when a penetrating hit destroys the opposing tank', () => {
    const content = contentFixture();
    const light = content.weapons.find((weapon) => weapon.id === 'light-cannon')!;
    Object.assign(light, { damage: 100, penetration: 100 });
    const engine = new GameplayEngineV2(
      config('scout', 'scout'), content, mapFixture(combatSpawns(6)),
    );

    engine.step([act({ fire: true }), idle]);
    engine.step([idle, idle]);
    const events = engine.step([idle, idle]);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'destroyed', teamId: 'team-b' }),
      expect.objectContaining({ type: 'match-ended', winningTeamIds: ['team-a'], reason: 'destroyed' }),
    ]));
    expect(engine.state).toMatchObject({ finished: true, winningTeamIds: ['team-a'], endReason: 'destroyed' });
  });
});

describe('GameplayEngineV2 capture mode', () => {
  it('wins when one living team continuously occupies the zone for the required ticks', () => {
    const map = captureMap([
      { id: 'a', x: 1, y: 1, bodyDirection: 2, turretDirection: 2 },
      { id: 'b', x: 10, y: 10, bodyDirection: 6, turretDirection: 6 },
    ]);
    const engine = new GameplayEngineV2(
      config('scout', 'heavy', 20, 'capture-test'), captureContent(3), map,
    );

    const first = engine.step([idle, idle]);
    engine.step([idle, idle]);
    const third = engine.step([idle, idle]);

    expect(first).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'capture-progress', teamId: 'team-a', progress: 1, required: 3 }),
    ]));
    expect(third).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'capture-progress', teamId: 'team-a', progress: 3, required: 3 }),
      expect.objectContaining({ type: 'match-ended', winningTeamIds: ['team-a'], reason: 'captured' }),
    ]));
    expect(engine.state).toMatchObject({
      finished: true,
      winningTeamIds: ['team-a'],
      endReason: 'captured',
      objective: { zoneId: 'center', capturingTeamId: 'team-a', progress: 3, required: 3, contested: false },
    });
  });

  it('marks a zone contested and prevents either team from gaining progress', () => {
    const map = captureMap([
      { id: 'a', x: 1, y: 1, bodyDirection: 2, turretDirection: 2 },
      { id: 'b', x: 2, y: 1, bodyDirection: 6, turretDirection: 6 },
    ], { id: 'center', x: 1, y: 1, width: 2, height: 1 });
    const engine = new GameplayEngineV2(
      config('scout', 'heavy', 20, 'capture-test'), captureContent(3), map,
    );

    const events = engine.step([idle, idle]);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'capture-contested', zoneId: 'center', teamIds: ['team-a', 'team-b'] }),
    ]));
    expect(engine.state).toMatchObject({
      finished: false,
      objective: { zoneId: 'center', capturingTeamId: null, progress: 0, required: 3, contested: true },
    });
  });

  it('resets partial progress when the occupying tank leaves the zone', () => {
    const map = captureMap([
      { id: 'a', x: 1, y: 1, bodyDirection: 2, turretDirection: 2 },
      { id: 'b', x: 10, y: 10, bodyDirection: 6, turretDirection: 6 },
    ]);
    const engine = new GameplayEngineV2(
      config('scout', 'heavy', 20, 'capture-test'), captureContent(3), map,
    );

    engine.step([act({ throttle: 1 }), idle]);
    const events = engine.step([act({ throttle: 1 }), idle]);

    expect(engine.state.tanks[0]).toMatchObject({ x: 2, y: 1 });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'capture-reset', zoneId: 'center', teamId: 'team-a' }),
    ]));
    expect(engine.state).toMatchObject({
      finished: false,
      objective: { zoneId: 'center', capturingTeamId: null, progress: 0, required: 3, contested: false },
    });
  });
});
