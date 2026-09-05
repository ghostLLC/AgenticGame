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
  // Old runners emitted before/after checkpoints at the same tick on failure.
  // Keep the final state of consecutive duplicates, after verifying integrity.
  const frames = bundle.checkpoints.filter((checkpoint, index, all) => all[index + 1]?.tick !== checkpoint.tick).map((checkpoint) => {
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
        hp: Math.max(0, integer(tank.hp, 'tank hp')),
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

  return assertFriendRoomReplayV1({
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
  });
}

export function assertFriendRoomReplayV1(value: unknown): FriendRoomReplayV1 {
  try {
    const root = exactRecord(value, ['version', 'modeName', 'map', 'participants', 'result', 'moments', 'frames']);
    if (root.version !== 1) invalid();
    boundedText(root.modeName, 1, 80);
    const map = exactRecord(root.map, ['id', 'width', 'height', 'terrainCells', 'captureZones']);
    stableText(map.id, 64);
    const width = boundedInteger(map.width, 1, 512);
    const height = boundedInteger(map.height, 1, 512);
    const terrainCells = boundedArray(map.terrainCells, 0, 20_000);
    terrainCells.forEach((cell) => {
      const item = exactRecord(cell, ['x', 'y', 'terrainId']);
      boundedInteger(item.x, 0, width - 1);
      boundedInteger(item.y, 0, height - 1);
      stableText(item.terrainId, 64);
    });
    const captureZones = boundedArray(map.captureZones, 0, 64);
    captureZones.forEach((zone) => {
      const item = exactRecord(zone, ['id', 'x', 'y', 'width', 'height']);
      stableText(item.id, 64);
      boundedInteger(item.x, 0, width - 1);
      boundedInteger(item.y, 0, height - 1);
      boundedInteger(item.width, 1, width);
      boundedInteger(item.height, 1, height);
    });

    const participants = boundedArray(root.participants, 2, 8);
    const teamIds = new Set<string>();
    participants.forEach((participant) => {
      const item = exactRecord(participant, ['teamId', 'displayName', 'vehicleName', 'weaponName']);
      const teamId = stableText(item.teamId, 64);
      if (teamIds.has(teamId)) invalid();
      teamIds.add(teamId);
      boundedText(item.displayName, 1, 80);
      boundedText(item.vehicleName, 1, 80);
      boundedText(item.weaponName, 1, 80);
    });

    const result = exactRecord(root.result, ['winningTeamIds', 'reason', 'ticks']);
    const ticks = boundedInteger(result.ticks, 0, 1_000_000);
    teamIdArray(result.winningTeamIds, teamIds, 0, participants.length);
    stableText(result.reason, 80);
    const moments = boundedArray(root.moments, 1, 20_000);
    moments.forEach((moment) => {
      const item = exactRecord(moment, ['tick', 'kind', 'title', 'summary', 'teamIds']);
      boundedInteger(item.tick, 0, ticks);
      if (!['start', 'damage', 'destruction', 'objective', 'system', 'result'].includes(String(item.kind))) invalid();
      boundedText(item.title, 1, 160);
      boundedText(item.summary, 0, 320);
      teamIdArray(item.teamIds, teamIds, 0, participants.length);
    });

    const frames = boundedArray(root.frames, 1, 20_000);
    let previousTick = -1;
    frames.forEach((frame) => {
      const item = exactRecord(frame, ['tick', 'tanks', 'projectiles', 'objective']);
      const tick = boundedInteger(item.tick, 0, ticks);
      if (tick <= previousTick) invalid();
      previousTick = tick;
      boundedArray(item.tanks, 1, 32).forEach((tank) => {
        const unit = exactRecord(tank, [
          'teamId', 'displayName', 'vehicleName', 'x', 'y', 'hp', 'maxHp',
          'bodyDirection', 'turretDirection', 'ammunition', 'alive',
        ]);
        if (!teamIds.has(stableText(unit.teamId, 64))) invalid();
        boundedText(unit.displayName, 1, 80);
        boundedText(unit.vehicleName, 1, 80);
        boundedInteger(unit.x, 0, width - 1);
        boundedInteger(unit.y, 0, height - 1);
        const maxHp = boundedInteger(unit.maxHp, 1, 1_000_000);
        boundedInteger(unit.hp, 0, maxHp);
        boundedInteger(unit.bodyDirection, 0, 7);
        boundedInteger(unit.turretDirection, 0, 7);
        boundedInteger(unit.ammunition, 0, 1_000_000);
        if (typeof unit.alive !== 'boolean') invalid();
      });
      boundedArray(item.projectiles, 0, 4_096).forEach((projectile) => {
        const shot = exactRecord(projectile, ['id', 'ownerTeamId', 'x', 'y', 'direction']);
        boundedInteger(shot.id, 0, Number.MAX_SAFE_INTEGER);
        if (!teamIds.has(stableText(shot.ownerTeamId, 64))) invalid();
        boundedInteger(shot.x, 0, width - 1);
        boundedInteger(shot.y, 0, height - 1);
        boundedInteger(shot.direction, 0, 7);
      });
      if (item.objective !== null) {
        const objective = exactRecord(item.objective, ['zoneId', 'capturingTeamId', 'progress', 'required', 'contested']);
        stableText(objective.zoneId, 64);
        if (objective.capturingTeamId !== null && !teamIds.has(stableText(objective.capturingTeamId, 64))) invalid();
        const required = boundedInteger(objective.required, 1, 1_000_000);
        boundedInteger(objective.progress, 0, required);
        if (typeof objective.contested !== 'boolean') invalid();
      }
    });
    if (frames.at(-1) && (frames.at(-1) as FriendRoomReplayFrameV1).tick !== ticks) invalid();
    return structuredClone(value) as FriendRoomReplayV1;
  } catch (error) {
    throw new Error('Invalid FriendRoomReplayV1', { cause: error });
  }
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

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || Object.keys(result).some((key) => !keys.includes(key))) invalid();
  return result;
}

function boundedArray(value: unknown, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function boundedText(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function stableText(value: unknown, maximum: number): string {
  const result = boundedText(value, 1, maximum);
  if (!/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(result)) invalid();
  return result;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid();
  return value as number;
}

function teamIdArray(value: unknown, teamIds: ReadonlySet<string>, minimum: number, maximum: number): void {
  const array = boundedArray(value, minimum, maximum);
  const seen = new Set<string>();
  for (const item of array) {
    const teamId = stableText(item, 64);
    if (!teamIds.has(teamId) || seen.has(teamId)) invalid();
    seen.add(teamId);
  }
}

function invalid(): never {
  throw new Error('invalid public replay field');
}
