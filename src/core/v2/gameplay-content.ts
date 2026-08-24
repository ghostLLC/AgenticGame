import type {
  ContentSnapshotV2,
  GameModeDefinitionV2,
  MapSnapshotV2,
  TerrainDefinitionV2,
  VehicleDefinitionV2,
  WeaponDefinitionV2,
} from './content.js';

const WIDTH = 32;
const HEIGHT = 24;

const vehicles: VehicleDefinitionV2[] = [
  {
    id: 'scout',
    displayName: '侦察坦克',
    role: 'scout',
    maxHp: 80,
    armor: { front: 15, side: 8, rear: 4 },
    mobility: {
      maxSpeedPermille: 1000,
      accelerationPermillePerTick: 500,
      decelerationPermillePerTick: 750,
      bodyTurnTicks: 1,
      turretTurnTicks: 1,
    },
    vision: { rangeCells: 10 },
    compatibleWeaponIds: ['light-cannon'],
    compatibleEquipmentIds: [],
  },
  {
    id: 'medium',
    displayName: '中型坦克',
    role: 'medium',
    maxHp: 110,
    armor: { front: 30, side: 18, rear: 10 },
    mobility: {
      maxSpeedPermille: 800,
      accelerationPermillePerTick: 400,
      decelerationPermillePerTick: 600,
      bodyTurnTicks: 1,
      turretTurnTicks: 1,
    },
    vision: { rangeCells: 8 },
    compatibleWeaponIds: ['medium-cannon'],
    compatibleEquipmentIds: [],
  },
  {
    id: 'heavy',
    displayName: '重型坦克',
    role: 'heavy',
    maxHp: 150,
    armor: { front: 55, side: 32, rear: 18 },
    mobility: {
      maxSpeedPermille: 600,
      accelerationPermillePerTick: 250,
      decelerationPermillePerTick: 400,
      bodyTurnTicks: 2,
      turretTurnTicks: 2,
    },
    vision: { rangeCells: 7 },
    compatibleWeaponIds: ['heavy-cannon'],
    compatibleEquipmentIds: [],
  },
];

const weapons: WeaponDefinitionV2[] = [
  {
    id: 'light-cannon', displayName: '轻型炮', damage: 24, penetration: 18,
    rangeCells: 9, reloadTicks: 3, projectileSpeedCellsPerTick: 2, ammunitionCapacity: 18,
  },
  {
    id: 'medium-cannon', displayName: '中型炮', damage: 34, penetration: 26,
    rangeCells: 10, reloadTicks: 4, projectileSpeedCellsPerTick: 2, ammunitionCapacity: 14,
  },
  {
    id: 'heavy-cannon', displayName: '重型炮', damage: 48, penetration: 40,
    rangeCells: 11, reloadTicks: 6, projectileSpeedCellsPerTick: 2, ammunitionCapacity: 10,
  },
];

const terrains: TerrainDefinitionV2[] = [
  {
    id: 'open-ground', displayName: '开阔地', movementCostPermille: 1000,
    visibilityModifierPermille: 1000, blocksMovement: false, blocksVision: false, blocksProjectiles: false,
  },
  {
    id: 'forest', displayName: '森林', movementCostPermille: 1100,
    visibilityModifierPermille: 700, blocksMovement: false, blocksVision: false, blocksProjectiles: false,
  },
  {
    id: 'mud', displayName: '泥地', movementCostPermille: 1600,
    visibilityModifierPermille: 1000, blocksMovement: false, blocksVision: false, blocksProjectiles: false,
  },
  {
    id: 'wall', displayName: '墙体', movementCostPermille: 1000,
    visibilityModifierPermille: 0, blocksMovement: true, blocksVision: true, blocksProjectiles: true,
  },
];

const modes: GameModeDefinitionV2[] = [{
  id: 'duel',
  displayName: '歼灭决斗',
  minTeams: 2,
  maxTeams: 2,
  victory: { kind: 'elimination-or-hp' },
}, {
  id: 'capture',
  displayName: '据点争夺',
  minTeams: 2,
  maxTeams: 2,
  victory: { kind: 'capture-or-elimination', captureTicks: 30 },
}];

export const GAMEPLAY_CONTENT_V2: ContentSnapshotV2 = deepFreeze({
  vehicles,
  weapons,
  terrains,
  modes,
});

export const GAMEPLAY_MAP_FRONTIER_V2: MapSnapshotV2 = deepFreeze({
  id: 'frontier-v2',
  version: '2.1.0',
  width: WIDTH,
  height: HEIGHT,
  terrainCells: createFrontierCells(),
  spawnPoints: [
    { id: 'spawn-west', x: 5, y: 12, bodyDirection: 2, turretDirection: 2 },
    { id: 'spawn-east', x: 26, y: 11, bodyDirection: 6, turretDirection: 6 },
  ],
  captureZones: [
    { id: 'central-zone', x: 14, y: 9, width: 4, height: 6 },
  ],
});

export function getVehicleV2(id: string): VehicleDefinitionV2 {
  const definition = GAMEPLAY_CONTENT_V2.vehicles.find((item) => item.id === id);
  if (!definition) throw new Error(`未知 v2 车辆: ${id}`);
  return definition;
}

export function getWeaponV2(id: string): WeaponDefinitionV2 {
  const definition = GAMEPLAY_CONTENT_V2.weapons.find((item) => item.id === id);
  if (!definition) throw new Error(`未知 v2 武器: ${id}`);
  return definition;
}

export function getTerrainV2(id: string): TerrainDefinitionV2 {
  const definition = GAMEPLAY_CONTENT_V2.terrains.find((item) => item.id === id);
  if (!definition) throw new Error(`未知 v2 地形: ${id}`);
  return definition;
}

function createFrontierCells(): Array<{ x: number; y: number; terrainId: string }> {
  const grid = Array.from({ length: HEIGHT }, () => Array<string>(WIDTH).fill('open-ground'));
  const paint = (terrainId: string, rectangles: ReadonlyArray<readonly [number, number, number, number]>) => {
    for (const [x, y, width, height] of rectangles) {
      for (let cellY = y; cellY < y + height; cellY += 1) {
        for (let cellX = x; cellX < x + width; cellX += 1) grid[cellY]![cellX] = terrainId;
      }
    }
  };

  paint('forest', [[3, 3, 5, 4], [24, 17, 5, 4]]);
  paint('mud', [[12, 0, 8, 5], [12, 19, 8, 5]]);
  paint('wall', [
    [11, 10, 2, 4],
    [19, 10, 2, 4],
    [7, 5, 3, 2],
    [22, 17, 3, 2],
    [7, 17, 3, 2],
    [22, 5, 3, 2],
  ]);

  return grid.flatMap((row, y) => row.map((terrainId, x) => ({ x, y, terrainId })));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
