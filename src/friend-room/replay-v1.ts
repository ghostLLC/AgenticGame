import type { CaptureZoneV2, TerrainCellV2 } from '../core/v2/content.js';
import { createReplayStudioViewV2, type ReplayStudioMomentV2 } from '../replay/studio-v2.js';
import { verifyMatchBundleV2, type MatchBundleV2 } from '../replay/v2.js';

export interface FriendRoomReplayTankV1 {
  teamId: string;
  displayName: string;
  vehicleName: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  bodyDirection: number;
  turretDirection: number;
  ammunition: number;
  alive: boolean;
}

export interface FriendRoomReplayProjectileV1 {
  id: number;
  ownerTeamId: string;
  x: number;
  y: number;
  direction: number;
}

export interface FriendRoomReplayObjectiveV1 {
  zoneId: string;
  capturingTeamId: string | null;
  progress: number;
  required: number;
  contested: boolean;
}

export interface FriendRoomReplayFrameV1 {
  tick: number;
  tanks: FriendRoomReplayTankV1[];
  projectiles: FriendRoomReplayProjectileV1[];
  objective: FriendRoomReplayObjectiveV1 | null;
}

export interface FriendRoomReplayV1 {
  version: 1;
  modeName: string;
  map: {
    id: string;
    width: number;
    height: number;
    terrainCells: TerrainCellV2[];
    captureZones: CaptureZoneV2[];
  };
  participants: Array<{
    teamId: string;
    displayName: string;
    vehicleName: string;
    weaponName: string;
  }>;
  result: {
    winningTeamIds: string[];
    reason: string;
    ticks: number;
  };
  moments: ReplayStudioMomentV2[];
  frames: FriendRoomReplayFrameV1[];
}

export function createFriendRoomReplayV1(bundle: MatchBundleV2): FriendRoomReplayV1 {
  const verification = verifyMatchBundleV2(bundle);
  if (!verification.ok) throw new Error('Friend room replay requires a verified bundle');
  const studio = createReplayStudioViewV2(bundle);
  const teams = new Map(bundle.config.teams.map((team) => [team.teamId, team]));
  const vehicles = new Map(bundle.contentSnapshot.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const frames = bundle.checkpoints.map((checkpoint) => {
    const state = record(checkpoint.state, 'checkpoint state');
    const tanks = array(state.tanks, 'checkpoint tanks').map((value) => {
      const tank = record(value, 'checkpoint tank');
      const teamId = text(tank.teamId, 'tank teamId');
      const vehicleId = text(tank.vehicleId, 'tank vehicleId');
      const team = teams.get(teamId);
      const vehicle = vehicles.get(vehicleId);
      if (!team || !vehicle) throw new Error('Friend room replay tank references unknown content');
      return {
        teamId,
        displayName: team.displayName,
        vehicleName: vehicle.displayName,
        x: integer(tank.x, 'tank x'),
        y: integer(tank.y, 'tank y'),
        hp: integer(tank.hp, 'tank hp'),
        maxHp: vehicle.maxHp,
        bodyDirection: direction(tank.bodyDirection, 'tank bodyDirection'),
        turretDirection: direction(tank.turretDirection, 'tank turretDirection'),
        ammunition: integer(tank.ammunition, 'tank ammunition'),
        alive: boolean(tank.alive, 'tank alive'),
      };
    });
    const projectiles = array(state.projectiles, 'checkpoint projectiles').map((value) => {
      const projectile = record(value, 'checkpoint projectile');
      return {
        id: integer(projectile.id, 'projectile id'),
        ownerTeamId: text(projectile.ownerTeamId, 'projectile ownerTeamId'),
        x: integer(projectile.x, 'projectile x'),
        y: integer(projectile.y, 'projectile y'),
        direction: direction(projectile.direction, 'projectile direction'),
      };
    });
    const objective = state.objective === null
      ? null
      : publicObjective(record(state.objective, 'checkpoint objective'));
    return { tick: checkpoint.tick, tanks, projectiles, objective };
  });

  return {
    version: 1,
    modeName: studio.modeName,
    map: {
      id: bundle.mapSnapshot.id,
      width: bundle.mapSnapshot.width,
      height: bundle.mapSnapshot.height,
      terrainCells: bundle.mapSnapshot.terrainCells.map((cell) => ({ ...cell })),
      captureZones: (bundle.mapSnapshot.captureZones ?? []).map((zone) => ({ ...zone })),
    },
    participants: studio.participants.map((participant) => ({
      teamId: participant.teamId,
      displayName: participant.displayName,
      vehicleName: participant.vehicleName,
      weaponName: participant.weaponName,
    })),
    result: structuredClone(studio.result),
    moments: structuredClone(studio.moments),
    frames,
  };
}

function publicObjective(value: Record<string, unknown>): FriendRoomReplayObjectiveV1 {
  return {
    zoneId: text(value.zoneId, 'objective zoneId'),
    capturingTeamId: value.capturingTeamId === null ? null : text(value.capturingTeamId, 'objective teamId'),
    progress: integer(value.progress, 'objective progress'),
    required: integer(value.required, 'objective required'),
    contested: boolean(value.contested, 'objective contested'),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid ${label}`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid ${label}`);
  return value as number;
}

function direction(value: unknown, label: string): number {
  const result = integer(value, label);
  if (result < 0 || result > 7) throw new Error(`Invalid ${label}`);
  return result;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}`);
  return value;
}
