import { dirDelta, dirDiff, turnDir } from '../constants.js';
import type { Dir, TankAction } from '../types.js';
import type {
  ContentSnapshotV2,
  CaptureZoneV2,
  MapSnapshotV2,
  TerrainDefinitionV2,
  VehicleDefinitionV2,
  WeaponDefinitionV2,
} from './content.js';
import type { JsonObject } from './json.js';
import { assertMatchConfigV2, type MatchConfigV2 } from './match-config.js';

export interface GameplayTankStateV2 {
  teamId: string;
  name: string;
  vehicleId: string;
  weaponId: string;
  x: number;
  y: number;
  hp: number;
  bodyDirection: Dir;
  turretDirection: Dir;
  velocityPermille: number;
  movementProgressPermille: number;
  bodyTurnCooldown: number;
  turretTurnCooldown: number;
  reloadTicksRemaining: number;
  ammunition: number;
  alive: boolean;
  violations: number;
}

export interface GameplayProjectileStateV2 {
  id: number;
  ownerTeamId: string;
  weaponId: string;
  x: number;
  y: number;
  direction: Dir;
  remainingRange: number;
}

export interface GameplayStateV2 {
  tick: number;
  tanks: [GameplayTankStateV2, GameplayTankStateV2];
  projectiles: GameplayProjectileStateV2[];
  nextProjectileId: number;
  finished: boolean;
  winningTeamIds: string[];
  endReason: string | null;
  objective: GameplayObjectiveStateV2 | null;
}

export interface GameplayObjectiveStateV2 {
  zoneId: string;
  capturingTeamId: string | null;
  progress: number;
  required: number;
  contested: boolean;
}

export interface BattleViewV2 {
  schemaVersion: 2;
  tick: number;
  field: { width: number; height: number };
  self: GameplayTankStateV2;
  visibleEnemies: GameplayTankStateV2[];
  visibleProjectiles: GameplayProjectileStateV2[];
  objective: GameplayObjectiveStateV2 | null;
}

export type ImpactZoneV2 = 'front' | 'side' | 'rear';

export type GameplayEventV2 =
  | { type: 'turn'; tick: number; teamId: string; part: 'body' | 'turret'; direction: Dir }
  | { type: 'move'; tick: number; teamId: string; x: number; y: number; terrainId: string }
  | { type: 'move-blocked'; tick: number; teamId: string; x: number; y: number }
  | { type: 'fire'; tick: number; teamId: string; projectileId: number; weaponId: string; ammunition: number }
  | { type: 'dry-fire'; tick: number; teamId: string; weaponId: string }
  | { type: 'projectile-blocked'; tick: number; teamId: string; projectileId: number; x: number; y: number }
  | { type: 'projectile-expired'; tick: number; teamId: string; projectileId: number; x: number; y: number }
  | {
    type: 'hit'; tick: number; projectileId: number; shooterTeamId: string; victimTeamId: string;
    x: number; y: number; impactZone: ImpactZoneV2; armor: number; penetration: number;
    baseDamage: number; damage: number; victimHp: number;
  }
  | { type: 'destroyed'; tick: number; teamId: string }
  | { type: 'capture-progress'; tick: number; zoneId: string; teamId: string; progress: number; required: number }
  | { type: 'capture-contested'; tick: number; zoneId: string; teamIds: string[] }
  | { type: 'capture-reset'; tick: number; zoneId: string; teamId: string }
  | { type: 'match-ended'; tick: number; winningTeamIds: string[]; reason: string };

export class GameplayEngineV2 {
  readonly state: GameplayStateV2;
  private readonly vehicles = new Map<string, VehicleDefinitionV2>();
  private readonly weapons = new Map<string, WeaponDefinitionV2>();
  private readonly terrains = new Map<string, TerrainDefinitionV2>();
  private readonly terrainGrid: string[][];
  private readonly captureZone: CaptureZoneV2 | null;

  constructor(
    readonly config: MatchConfigV2,
    readonly content: ContentSnapshotV2,
    readonly map: MapSnapshotV2,
  ) {
    assertMatchConfigV2(config);
    if (config.teams.length !== 2) throw new Error('Gameplay v2 首期仅支持恰好两个队伍');
    if (config.mapId !== map.id) throw new Error(`地图引用不匹配: ${config.mapId} != ${map.id}`);
    const mode = content.modes.find((item) => item.id === config.modeId);
    if (!mode) throw new Error(`未知模式引用: ${config.modeId}`);
    indexUnique(content.vehicles, this.vehicles, '车辆');
    indexUnique(content.weapons, this.weapons, '武器');
    indexUnique(content.terrains, this.terrains, '地形');
    if (map.spawnPoints.length < 2) throw new Error('Gameplay v2 地图至少需要两个出生点');
    this.terrainGrid = compileTerrainGrid(map, this.terrains);
    const captureRules = resolveCaptureRules(mode.victory, map);
    this.captureZone = captureRules?.zone ?? null;
    if (this.captureZone) validateCaptureZone(this.captureZone, map, (x, y) => this.terrainAt(x, y));

    const tanks = config.teams.map((team, index) => {
      const vehicle = this.vehicles.get(team.loadout.vehicleId);
      if (!vehicle) throw new Error(`未知车辆引用: ${team.loadout.vehicleId}`);
      if (team.loadout.weaponIds.length !== 1) throw new Error(`队伍 ${team.teamId} 必须且只能装备一门武器`);
      const weaponId = team.loadout.weaponIds[0]!;
      const weapon = this.weapons.get(weaponId);
      if (!weapon) throw new Error(`未知武器引用: ${weaponId}`);
      if (!vehicle.compatibleWeaponIds.includes(weaponId)) {
        throw new Error(`车辆 ${vehicle.id} 不兼容武器 ${weaponId}`);
      }
      const spawn = map.spawnPoints[index]!;
      if (this.terrainAt(spawn.x, spawn.y).blocksMovement) throw new Error(`出生点 ${spawn.id} 位于不可通行地形`);
      return {
        teamId: team.teamId,
        name: team.displayName,
        vehicleId: vehicle.id,
        weaponId,
        x: spawn.x,
        y: spawn.y,
        hp: vehicle.maxHp,
        bodyDirection: spawn.bodyDirection as Dir,
        turretDirection: spawn.turretDirection as Dir,
        velocityPermille: 0,
        movementProgressPermille: 0,
        bodyTurnCooldown: 0,
        turretTurnCooldown: 0,
        reloadTicksRemaining: 0,
        ammunition: weapon.ammunitionCapacity,
        alive: true,
        violations: 0,
      } satisfies GameplayTankStateV2;
    }) as [GameplayTankStateV2, GameplayTankStateV2];

    this.state = {
      tick: 0,
      tanks,
      projectiles: [],
      nextProjectileId: 1,
      finished: false,
      winningTeamIds: [],
      endReason: null,
      objective: captureRules ? {
        zoneId: captureRules.zone.id,
        capturingTeamId: null,
        progress: 0,
        required: captureRules.required,
        contested: false,
      } : null,
    };
  }

  step(actions: readonly [TankAction, TankAction]): GameplayEventV2[] {
    if (this.state.finished) return [];
    const events: GameplayEventV2[] = [];
    const tick = this.state.tick;

    for (const tank of this.state.tanks) {
      if (!tank.alive) continue;
      tank.bodyTurnCooldown = Math.max(0, tank.bodyTurnCooldown - 1);
      tank.turretTurnCooldown = Math.max(0, tank.turretTurnCooldown - 1);
      tank.reloadTicksRemaining = Math.max(0, tank.reloadTicksRemaining - 1);
    }

    this.state.tanks.forEach((tank, index) => {
      if (!tank.alive) return;
      const action = actions[index]!;
      const vehicle = this.vehicleFor(tank);
      if (action.bodyTurn !== 0 && tank.bodyTurnCooldown === 0) {
        tank.bodyDirection = turnDir(tank.bodyDirection, action.bodyTurn);
        tank.bodyTurnCooldown = vehicle.mobility.bodyTurnTicks;
        events.push({ type: 'turn', tick, teamId: tank.teamId, part: 'body', direction: tank.bodyDirection });
      }
      if (action.turretTurn !== 0 && tank.turretTurnCooldown === 0) {
        tank.turretDirection = turnDir(tank.turretDirection, action.turretTurn);
        tank.turretTurnCooldown = vehicle.mobility.turretTurnTicks;
        events.push({ type: 'turn', tick, teamId: tank.teamId, part: 'turret', direction: tank.turretDirection });
      }
    });

    this.state.tanks.forEach((tank, index) => {
      if (!tank.alive) return;
      const action = actions[index]!;
      const mobility = this.vehicleFor(tank).mobility;
      const targetVelocity = action.throttle * mobility.maxSpeedPermille;
      const rate = targetVelocity === 0
        || (tank.velocityPermille !== 0 && Math.sign(targetVelocity) !== Math.sign(tank.velocityPermille))
        ? mobility.decelerationPermillePerTick
        : mobility.accelerationPermillePerTick;
      tank.velocityPermille = approach(tank.velocityPermille, targetVelocity, rate);
      tank.movementProgressPermille += Math.abs(tank.velocityPermille);
      if (tank.velocityPermille === 0) return;

      const [dx, dy] = dirDelta(tank.bodyDirection);
      const direction = Math.sign(tank.velocityPermille);
      const x = tank.x + dx * direction;
      const y = tank.y + dy * direction;
      const destination = this.inBounds(x, y) ? this.terrainAt(x, y) : null;
      const movementCost = destination?.movementCostPermille ?? 1000;
      if (tank.movementProgressPermille < movementCost) return;
      if (!destination || destination.blocksMovement || this.isOccupied(x, y, tank.teamId)) {
        tank.velocityPermille = 0;
        tank.movementProgressPermille = 0;
        events.push({ type: 'move-blocked', tick, teamId: tank.teamId, x, y });
        return;
      }
      tank.x = x;
      tank.y = y;
      tank.movementProgressPermille -= movementCost;
      events.push({ type: 'move', tick, teamId: tank.teamId, x, y, terrainId: destination.id });
    });

    const flying: GameplayProjectileStateV2[] = [];
    for (const projectile of this.state.projectiles) {
      const weapon = this.weapons.get(projectile.weaponId)!;
      const [dx, dy] = dirDelta(projectile.direction);
      let remainsInPlay = true;
      for (let substep = 0; substep < weapon.projectileSpeedCellsPerTick && remainsInPlay; substep += 1) {
        projectile.x += dx;
        projectile.y += dy;
        projectile.remainingRange -= 1;
        if (!this.inBounds(projectile.x, projectile.y)
          || this.terrainAt(projectile.x, projectile.y).blocksProjectiles) {
          events.push({
            type: 'projectile-blocked', tick, teamId: projectile.ownerTeamId,
            projectileId: projectile.id, x: projectile.x, y: projectile.y,
          });
          remainsInPlay = false;
          break;
        }
        const victim = this.state.tanks.find((tank) =>
          tank.alive && tank.teamId !== projectile.ownerTeamId && tank.x === projectile.x && tank.y === projectile.y,
        );
        if (victim) {
          const vehicle = this.vehicleFor(victim);
          const impactZone = classifyImpactZone(projectile.direction, victim.bodyDirection);
          const armor = vehicle.armor[impactZone];
          const damage = Math.max(1, weapon.damage - Math.max(0, armor - weapon.penetration));
          victim.hp -= damage;
          events.push({
            type: 'hit', tick, projectileId: projectile.id, shooterTeamId: projectile.ownerTeamId,
            victimTeamId: victim.teamId, x: projectile.x, y: projectile.y, impactZone, armor,
            penetration: weapon.penetration, baseDamage: weapon.damage, damage, victimHp: victim.hp,
          });
          remainsInPlay = false;
          break;
        }
        if (projectile.remainingRange <= 0) {
          events.push({
            type: 'projectile-expired', tick, teamId: projectile.ownerTeamId,
            projectileId: projectile.id, x: projectile.x, y: projectile.y,
          });
          remainsInPlay = false;
        }
      }
      if (remainsInPlay) flying.push(projectile);
    }
    this.state.projectiles = flying;

    this.state.tanks.forEach((tank, index) => {
      if (!tank.alive || !actions[index]!.fire || tank.reloadTicksRemaining > 0) return;
      const weapon = this.weapons.get(tank.weaponId)!;
      if (tank.ammunition <= 0) {
        events.push({ type: 'dry-fire', tick, teamId: tank.teamId, weaponId: tank.weaponId });
        return;
      }
      const projectile: GameplayProjectileStateV2 = {
        id: this.state.nextProjectileId++,
        ownerTeamId: tank.teamId,
        weaponId: tank.weaponId,
        x: tank.x,
        y: tank.y,
        direction: tank.turretDirection,
        remainingRange: weapon.rangeCells,
      };
      tank.ammunition -= 1;
      tank.reloadTicksRemaining = weapon.reloadTicks;
      this.state.projectiles.push(projectile);
      events.push({
        type: 'fire', tick, teamId: tank.teamId, projectileId: projectile.id,
        weaponId: tank.weaponId, ammunition: tank.ammunition,
      });
    });

    for (const tank of this.state.tanks) {
      if (tank.alive && tank.hp <= 0) {
        tank.alive = false;
        events.push({ type: 'destroyed', tick, teamId: tank.teamId });
      }
    }
    const survivors = this.state.tanks.filter((tank) => tank.alive);
    if (survivors.length <= 1) {
      this.endMatch(events, survivors.map((tank) => tank.teamId), 'destroyed');
    }
    if (!this.state.finished) this.updateCaptureObjective(events);

    this.state.tick += 1;
    if (!this.state.finished && this.state.tick >= this.config.maxTicks) {
      const [a, b] = this.state.tanks;
      const winningTeamIds = a.hp === b.hp ? [] : [a.hp > b.hp ? a.teamId : b.teamId];
      this.endMatch(events, winningTeamIds, 'max-ticks');
    }
    return events;
  }

  viewFor(teamIndex: 0 | 1): BattleViewV2 {
    const self = this.state.tanks[teamIndex];
    const enemy = this.state.tanks[(1 - teamIndex) as 0 | 1];
    const visibleEnemies = enemy.alive && this.canSee(self, enemy.x, enemy.y, true) ? [{ ...enemy }] : [];
    const visibleProjectiles = this.state.projectiles
      .filter((projectile) => this.canSee(self, projectile.x, projectile.y, false))
      .map((projectile) => ({ ...projectile }));
    return {
      schemaVersion: 2,
      tick: this.state.tick,
      field: { width: this.map.width, height: this.map.height },
      self: { ...self },
      visibleEnemies,
      visibleProjectiles,
      objective: this.state.objective ? { ...this.state.objective } : null,
    };
  }

  forceFinish(winningTeamIds: string[], reason: string): GameplayEventV2[] {
    if (this.state.finished) return [];
    const events: GameplayEventV2[] = [];
    this.endMatch(events, winningTeamIds, reason);
    return events;
  }

  snapshot(): JsonObject {
    return structuredClone(this.state) as unknown as JsonObject;
  }

  private vehicleFor(tank: GameplayTankStateV2): VehicleDefinitionV2 {
    return this.vehicles.get(tank.vehicleId)!;
  }

  private terrainAt(x: number, y: number): TerrainDefinitionV2 {
    return this.terrains.get(this.terrainGrid[y]![x]!)!;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.map.width && y < this.map.height;
  }

  private isOccupied(x: number, y: number, movingTeamId: string): boolean {
    return this.state?.tanks.some((tank) => tank.alive && tank.teamId !== movingTeamId && tank.x === x && tank.y === y) ?? false;
  }

  private endMatch(events: GameplayEventV2[], winningTeamIds: string[], reason: string): void {
    if (this.state.finished) return;
    this.state.finished = true;
    this.state.winningTeamIds = [...winningTeamIds];
    this.state.endReason = reason;
    events.push({ type: 'match-ended', tick: this.state.tick, winningTeamIds: [...winningTeamIds], reason });
  }

  private updateCaptureObjective(events: GameplayEventV2[]): void {
    const objective = this.state.objective;
    const zone = this.captureZone;
    if (!objective || !zone) return;
    const occupyingTeamIds = this.state.tanks
      .filter((tank) => tank.alive && isInsideZone(tank.x, tank.y, zone))
      .map((tank) => tank.teamId);

    if (occupyingTeamIds.length === 1) {
      const teamId = occupyingTeamIds[0]!;
      if (objective.capturingTeamId !== teamId) {
        if (objective.capturingTeamId && objective.progress > 0) {
          events.push({
            type: 'capture-reset', tick: this.state.tick, zoneId: zone.id,
            teamId: objective.capturingTeamId,
          });
        }
        objective.capturingTeamId = teamId;
        objective.progress = 0;
      }
      objective.contested = false;
      objective.progress += 1;
      events.push({
        type: 'capture-progress', tick: this.state.tick, zoneId: zone.id,
        teamId, progress: objective.progress, required: objective.required,
      });
      if (objective.progress >= objective.required) this.endMatch(events, [teamId], 'captured');
      return;
    }

    if (objective.capturingTeamId && objective.progress > 0) {
      events.push({
        type: 'capture-reset', tick: this.state.tick, zoneId: zone.id,
        teamId: objective.capturingTeamId,
      });
    }
    objective.capturingTeamId = null;
    objective.progress = 0;
    if (occupyingTeamIds.length > 1) {
      if (!objective.contested) {
        events.push({
          type: 'capture-contested', tick: this.state.tick, zoneId: zone.id,
          teamIds: occupyingTeamIds,
        });
      }
      objective.contested = true;
    } else {
      objective.contested = false;
    }
  }

  private canSee(observer: GameplayTankStateV2, x: number, y: number, applyTargetTerrain: boolean): boolean {
    const distance = Math.max(Math.abs(x - observer.x), Math.abs(y - observer.y));
    const visibility = applyTargetTerrain ? this.terrainAt(x, y).visibilityModifierPermille : 1000;
    if (distance * 1000 > this.vehicleFor(observer).vision.rangeCells * visibility) return false;
    return lineCellsBetween(observer.x, observer.y, x, y)
      .every((cell) => !this.terrainAt(cell.x, cell.y).blocksVision);
  }
}

function resolveCaptureRules(
  victory: JsonObject,
  map: MapSnapshotV2,
): { zone: CaptureZoneV2; required: number } | null {
  if (victory.kind !== 'capture-or-elimination') return null;
  const required = victory.captureTicks;
  if (!Number.isSafeInteger(required) || (required as number) < 1) {
    throw new Error('占领模式 captureTicks 必须是正整数');
  }
  if (map.captureZones?.length !== 1) throw new Error('占领模式首期必须且只能配置一个占领区域');
  return { zone: map.captureZones[0]!, required: required as number };
}

function validateCaptureZone(
  zone: CaptureZoneV2,
  map: MapSnapshotV2,
  terrainAt: (x: number, y: number) => TerrainDefinitionV2,
): void {
  if (!zone.id || !Number.isSafeInteger(zone.x) || !Number.isSafeInteger(zone.y)
    || !Number.isSafeInteger(zone.width) || !Number.isSafeInteger(zone.height)
    || zone.width < 1 || zone.height < 1
    || zone.x < 0 || zone.y < 0 || zone.x + zone.width > map.width || zone.y + zone.height > map.height) {
    throw new Error(`非法占领区域: ${zone.id}`);
  }
  for (let y = zone.y; y < zone.y + zone.height; y += 1) {
    for (let x = zone.x; x < zone.x + zone.width; x += 1) {
      if (terrainAt(x, y).blocksMovement) throw new Error(`占领区域包含不可通行地形: ${zone.id}@${x},${y}`);
    }
  }
}

function isInsideZone(x: number, y: number, zone: CaptureZoneV2): boolean {
  return x >= zone.x && y >= zone.y && x < zone.x + zone.width && y < zone.y + zone.height;
}

function indexUnique<T extends { id: string }>(items: readonly T[], output: Map<string, T>, label: string): void {
  for (const item of items) {
    if (output.has(item.id)) throw new Error(`重复${label} ID: ${item.id}`);
    output.set(item.id, item);
  }
}

function compileTerrainGrid(
  map: MapSnapshotV2,
  terrains: ReadonlyMap<string, TerrainDefinitionV2>,
): string[][] {
  const grid = Array.from({ length: map.height }, () => Array<string | null>(map.width).fill(null));
  for (const cell of map.terrainCells) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= map.width || cell.y >= map.height) {
      throw new Error(`地形格越界: ${cell.x},${cell.y}`);
    }
    if (!terrains.has(cell.terrainId)) throw new Error(`未知地形引用: ${cell.terrainId}`);
    if (grid[cell.y]![cell.x] !== null) throw new Error(`重复地形格: ${cell.x},${cell.y}`);
    grid[cell.y]![cell.x] = cell.terrainId;
  }
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (grid[y]![x] === null) throw new Error(`缺失地形格: ${x},${y}`);
    }
  }
  return grid as string[][];
}

function approach(value: number, target: number, rate: number): number {
  if (value < target) return Math.min(target, value + rate);
  if (value > target) return Math.max(target, value - rate);
  return value;
}

function classifyImpactZone(projectileDirection: Dir, victimBodyDirection: Dir): ImpactZoneV2 {
  const sourceDirection = turnDir(projectileDirection, 4);
  const relative = Math.abs(dirDiff(victimBodyDirection, sourceDirection));
  if (relative <= 1) return 'front';
  if (relative === 2) return 'side';
  return 'rear';
}

function lineCellsBetween(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);
  let x = x0;
  let y = y0;
  let movedX = 0;
  let movedY = 0;
  while (movedX < dx || movedY < dy) {
    const decision = (1 + 2 * movedX) * dy - (1 + 2 * movedY) * dx;
    if (decision === 0) {
      x += stepX;
      y += stepY;
      movedX += 1;
      movedY += 1;
    } else if (decision < 0) {
      x += stepX;
      movedX += 1;
    } else {
      y += stepY;
      movedY += 1;
    }
    if (x !== x1 || y !== y1) cells.push({ x, y });
  }
  return cells;
}
