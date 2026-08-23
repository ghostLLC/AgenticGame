import type { JsonObject } from './json.js';

export type Direction8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface VehicleDefinitionV2 {
  id: string;
  displayName: string;
  role: string;
  maxHp: number;
  armor: {
    front: number;
    side: number;
    rear: number;
  };
  mobility: {
    maxSpeedPermille: number;
    accelerationPermillePerTick: number;
    decelerationPermillePerTick: number;
    bodyTurnTicks: number;
    turretTurnTicks: number;
  };
  vision: {
    rangeCells: number;
  };
  compatibleWeaponIds: readonly string[];
  compatibleEquipmentIds: readonly string[];
}

export interface WeaponDefinitionV2 {
  id: string;
  displayName: string;
  damage: number;
  penetration: number;
  rangeCells: number;
  reloadTicks: number;
  projectileSpeedCellsPerTick: number;
  ammunitionCapacity: number;
}

export interface TerrainDefinitionV2 {
  id: string;
  displayName: string;
  movementCostPermille: number;
  visibilityModifierPermille: number;
  blocksMovement: boolean;
  blocksVision: boolean;
  blocksProjectiles: boolean;
}

export interface GameModeDefinitionV2 {
  id: string;
  displayName: string;
  minTeams: number;
  maxTeams: number;
  victory: JsonObject;
}

export interface ContentSnapshotV2 {
  vehicles: readonly VehicleDefinitionV2[];
  weapons: readonly WeaponDefinitionV2[];
  terrains: readonly TerrainDefinitionV2[];
  modes: readonly GameModeDefinitionV2[];
}

export interface TerrainCellV2 {
  x: number;
  y: number;
  terrainId: string;
}

export interface SpawnPointV2 {
  id: string;
  teamId?: string;
  x: number;
  y: number;
  bodyDirection: Direction8;
  turretDirection: Direction8;
}

export interface MapSnapshotV2 {
  id: string;
  version: string;
  width: number;
  height: number;
  terrainCells: readonly TerrainCellV2[];
  spawnPoints: readonly SpawnPointV2[];
}

export interface BotArtifactSnapshotV2 {
  artifactId: string;
  version: string;
  codeHash: string;
  language: 'javascript' | 'typescript';
  entryPoint: string;
  source: string;
}
