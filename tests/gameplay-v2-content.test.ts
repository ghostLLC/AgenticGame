import { describe, expect, it } from 'vitest';
import {
  GAMEPLAY_CONTENT_V2,
  GAMEPLAY_MAP_FRONTIER_V2,
  getTerrainV2,
  getVehicleV2,
  getWeaponV2,
} from '../src/core/v2/gameplay-content.js';

describe('gameplay v2 official content', () => {
  it('ships three resolved loadouts with materially different combat profiles', () => {
    expect(GAMEPLAY_CONTENT_V2.vehicles.map((vehicle) => ({
      id: vehicle.id,
      hp: vehicle.maxHp,
      armor: vehicle.armor,
      speed: vehicle.mobility.maxSpeedPermille,
      acceleration: vehicle.mobility.accelerationPermillePerTick,
      bodyTurnTicks: vehicle.mobility.bodyTurnTicks,
      vision: vehicle.vision.rangeCells,
      weapons: vehicle.compatibleWeaponIds,
    }))).toEqual([
      {
        id: 'scout', hp: 80, armor: { front: 15, side: 8, rear: 4 },
        speed: 1000, acceleration: 500, bodyTurnTicks: 1, vision: 10,
        weapons: ['light-cannon'],
      },
      {
        id: 'medium', hp: 110, armor: { front: 30, side: 18, rear: 10 },
        speed: 800, acceleration: 400, bodyTurnTicks: 1, vision: 8,
        weapons: ['medium-cannon'],
      },
      {
        id: 'heavy', hp: 150, armor: { front: 55, side: 32, rear: 18 },
        speed: 600, acceleration: 250, bodyTurnTicks: 2, vision: 7,
        weapons: ['heavy-cannon'],
      },
    ]);

    expect(GAMEPLAY_CONTENT_V2.weapons.map((weapon) => ({
      id: weapon.id,
      damage: weapon.damage,
      penetration: weapon.penetration,
      range: weapon.rangeCells,
      reload: weapon.reloadTicks,
      ammo: weapon.ammunitionCapacity,
    }))).toEqual([
      { id: 'light-cannon', damage: 24, penetration: 18, range: 9, reload: 3, ammo: 18 },
      { id: 'medium-cannon', damage: 34, penetration: 26, range: 10, reload: 4, ammo: 14 },
      { id: 'heavy-cannon', damage: 48, penetration: 40, range: 11, reload: 6, ammo: 10 },
    ]);

    for (const vehicle of GAMEPLAY_CONTENT_V2.vehicles) {
      expect(getVehicleV2(vehicle.id)).toBe(vehicle);
      for (const weaponId of vehicle.compatibleWeaponIds) expect(getWeaponV2(weaponId).id).toBe(weaponId);
    }
  });

  it('covers every frontier cell exactly once with symmetric spawns and working terrain semantics', () => {
    const map = GAMEPLAY_MAP_FRONTIER_V2;
    expect(map).toMatchObject({ id: 'frontier-v2', version: '2.0.0', width: 32, height: 24 });
    expect(map.terrainCells).toHaveLength(32 * 24);
    expect(new Set(map.terrainCells.map((cell) => `${cell.x},${cell.y}`)).size).toBe(32 * 24);
    expect(map.terrainCells.every((cell) => getTerrainV2(cell.terrainId).id === cell.terrainId)).toBe(true);

    const [a, b] = map.spawnPoints;
    expect(a!.x + b!.x).toBe(map.width - 1);
    expect(a!.y + b!.y).toBe(map.height - 1);
    expect(getTerrainV2('forest')).toMatchObject({ movementCostPermille: 1100, visibilityModifierPermille: 700 });
    expect(getTerrainV2('mud')).toMatchObject({ movementCostPermille: 1600, blocksMovement: false });
    expect(getTerrainV2('wall')).toMatchObject({ blocksMovement: true, blocksVision: true, blocksProjectiles: true });
  });
});
