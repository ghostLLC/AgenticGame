import { createHash } from 'node:crypto';
import { buildObstacleGrid } from '../core/maps.js';
import type { GameMap, GameState, Rules, TankAction, Winner } from '../core/types.js';
import type {
  BotArtifactSnapshotV2,
  ContentSnapshotV2,
  MapSnapshotV2,
} from '../core/v2/content.js';
import type { JsonObject } from '../core/v2/json.js';
import type { MatchConfigV2 } from '../core/v2/match-config.js';
import type { MatchTeamConfigV2 } from '../core/v2/match-config.js';
import type { Replay, ReplayFrame } from '../replay/format.js';
import {
  createMatchBundleV2,
  type ActionRecordV2,
  type EventRecordV2,
  type LogRecordV2,
  type MatchBundleV2,
  type StateCheckpointInputV2,
} from '../replay/v2.js';

const ENGINE_VERSION = '0.1.0';
const ARTIFACT_VERSION = '1.0.0';
const VEHICLE_ID = 'legacy-tank';
const WEAPON_ID = 'legacy-cannon';
const MODE_ID = 'legacy-duel';
const TEAM_IDS = ['team-a', 'team-b'] as const;
const ARTIFACT_IDS = ['team-a-bot', 'team-b-bot'] as const;

export interface LegacyBotSourceV2 {
  code: string;
  file: string;
}

export interface LegacyMatchBundleInputV2 {
  createdAt: string;
  seed: number;
  map: GameMap;
  rules: Rules;
  botNames: readonly [string, string];
  bots: readonly [LegacyBotSourceV2, LegacyBotSourceV2];
  replay: Replay;
  actions: readonly ActionRecordV2[];
  state: GameState;
  winner: Winner;
  ticks: number;
}

export function createLegacyMatchBundleV2(input: LegacyMatchBundleInputV2): MatchBundleV2 {
  const botArtifacts = createBotArtifacts(input.bots);
  const config = createConfig(input, botArtifacts);
  return createMatchBundleV2({
    engineVersion: ENGINE_VERSION,
    createdAt: input.createdAt,
    config,
    mapSnapshot: createMapSnapshot(input.map),
    contentSnapshot: createContentSnapshot(input.rules),
    botArtifacts,
    actions: structuredClone(input.actions) as ActionRecordV2[],
    events: createEvents(input.replay.frames),
    checkpoints: createCheckpoints(input.replay.frames, input.state.mapId),
    logs: createLogs(input.replay.frames),
    result: {
      winningTeamIds: input.winner === 0 || input.winner === 1 ? [TEAM_IDS[input.winner]] : [],
      reason: input.state.endReason ?? 'unknown',
      ticks: input.ticks,
    },
  });
}

export function actionRecordV2(tick: number, teamIndex: 0 | 1, action: TankAction): ActionRecordV2 {
  return {
    tick,
    actorId: TEAM_IDS[teamIndex],
    action: { ...action },
  };
}

export function fullCodeHash(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

function createConfig(
  input: LegacyMatchBundleInputV2,
  artifacts: readonly [BotArtifactSnapshotV2, BotArtifactSnapshotV2],
): MatchConfigV2 {
  return {
    schemaVersion: 2,
    matchId: `legacy-${input.map.id}-${input.seed >>> 0}`,
    ruleset: { id: 'legacy-rules', version: ENGINE_VERSION },
    modeId: MODE_ID,
    mapId: input.map.id,
    seed: input.seed >>> 0,
    maxTicks: input.rules.maxTicks,
    teams: [createTeam(input, artifacts, 0), createTeam(input, artifacts, 1)],
  };
}

function createTeam(
  input: LegacyMatchBundleInputV2,
  artifacts: readonly [BotArtifactSnapshotV2, BotArtifactSnapshotV2],
  index: 0 | 1,
): MatchTeamConfigV2 {
  return {
    teamId: TEAM_IDS[index],
    displayName: normalizeDisplayName(input.botNames[index], `Tank ${index}`),
    bot: {
      artifactId: ARTIFACT_IDS[index],
      version: ARTIFACT_VERSION,
      codeHash: artifacts[index].codeHash,
    },
    loadout: {
      vehicleId: VEHICLE_ID,
      weaponIds: [WEAPON_ID],
      equipmentIds: [],
    },
  };
}

function createBotArtifacts(
  bots: readonly [LegacyBotSourceV2, LegacyBotSourceV2],
): [BotArtifactSnapshotV2, BotArtifactSnapshotV2] {
  const createArtifact = (bot: LegacyBotSourceV2, index: 0 | 1): BotArtifactSnapshotV2 => ({
    artifactId: ARTIFACT_IDS[index],
    version: ARTIFACT_VERSION,
    codeHash: fullCodeHash(bot.code),
    language: 'javascript',
    entryPoint: bot.file,
    source: bot.code,
  });
  return [createArtifact(bots[0], 0), createArtifact(bots[1], 1)];
}

function createContentSnapshot(rules: Rules): ContentSnapshotV2 {
  return {
    vehicles: [{
      id: VEHICLE_ID,
      displayName: 'Legacy Tank',
      role: 'medium',
      maxHp: rules.maxHp,
      armor: { front: 0, side: 0, rear: 0 },
      mobility: {
        maxSpeedPermille: 1000,
        accelerationPermillePerTick: 1000,
        decelerationPermillePerTick: 1000,
        bodyTurnTicks: 1,
        turretTurnTicks: 1,
      },
      vision: { rangeCells: Math.max(rules.fieldWidth, rules.fieldHeight) },
      compatibleWeaponIds: [WEAPON_ID],
      compatibleEquipmentIds: [],
    }],
    weapons: [{
      id: WEAPON_ID,
      displayName: 'Legacy Cannon',
      damage: rules.bulletDamage,
      penetration: 0,
      rangeCells: Math.max(rules.fieldWidth, rules.fieldHeight),
      reloadTicks: rules.fireCooldown,
      projectileSpeedCellsPerTick: rules.bulletSpeed,
      ammunitionCapacity: rules.maxTicks + 1,
    }],
    terrains: [
      {
        id: 'open-ground',
        displayName: 'Open Ground',
        movementCostPermille: 1000,
        visibilityModifierPermille: 1000,
        blocksMovement: false,
        blocksVision: false,
        blocksProjectiles: false,
      },
      {
        id: 'obstacle',
        displayName: 'Obstacle',
        movementCostPermille: 1000,
        visibilityModifierPermille: 0,
        blocksMovement: true,
        blocksVision: true,
        blocksProjectiles: true,
      },
    ],
    modes: [{
      id: MODE_ID,
      displayName: 'Legacy Duel',
      minTeams: 2,
      maxTeams: 2,
      victory: { kind: 'elimination-or-hp', maxTicks: rules.maxTicks },
    }],
  };
}

function createMapSnapshot(map: GameMap): MapSnapshotV2 {
  const obstacles = buildObstacleGrid(map);
  const terrainCells = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      terrainCells.push({ x, y, terrainId: obstacles[y]![x] ? 'obstacle' : 'open-ground' });
    }
  }
  return {
    id: map.id,
    version: '1.0.0',
    width: map.width,
    height: map.height,
    terrainCells,
    spawnPoints: map.spawns.map((spawn, index) => ({
      id: `${TEAM_IDS[index]}-spawn`,
      teamId: TEAM_IDS[index],
      x: spawn.x,
      y: spawn.y,
      bodyDirection: spawn.dir,
      turretDirection: spawn.dir,
    })),
  };
}

function createEvents(frames: readonly ReplayFrame[]): EventRecordV2[] {
  return frames.flatMap((frame) => frame.events.map((event) => {
    const { tick, type, ...payload } = event;
    return {
      tick,
      type: stableEventType(type),
      payload: payload as unknown as JsonObject,
    };
  }));
}

function createCheckpoints(frames: readonly ReplayFrame[], mapId: string): StateCheckpointInputV2[] {
  return frames.map((frame) => ({
    tick: frame.tick,
    state: {
      mapId,
      tanks: frame.tanks,
      bullets: frame.bullets,
    } as unknown as JsonObject,
  }));
}

function createLogs(frames: readonly ReplayFrame[]): LogRecordV2[] {
  return frames.flatMap((frame) => {
    if (!frame.logs) return [];
    const tick = Math.max(0, frame.tick - 1);
    return [
      ...frame.logs[0].map((message) => ({ tick, sourceId: TEAM_IDS[0], level: 'debug' as const, message })),
      ...frame.logs[1].map((message) => ({ tick, sourceId: TEAM_IDS[1], level: 'debug' as const, message })),
    ];
  });
}

function stableEventType(type: string): string {
  return type.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function normalizeDisplayName(value: string, fallback: string): string {
  const normalized = value.trim();
  return (normalized.length > 0 ? normalized : fallback).slice(0, 80);
}
