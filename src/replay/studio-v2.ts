import type { MatchTeamConfigV2 } from '../core/v2/match-config.js';
import {
  verifyMatchBundleV2,
  type EventRecordV2,
  type MatchBundleV2,
  type StateCheckpointV2,
} from './v2.js';

export type ReplayParticipantOutcomeV2 = 'winner' | 'defeated' | 'draw';
export type ReplayMomentKindV2 = 'start' | 'damage' | 'destruction' | 'system' | 'result';

export interface ReplayStudioParticipantV2 {
  teamId: string;
  displayName: string;
  vehicleName: string;
  weaponName: string;
  outcome: ReplayParticipantOutcomeV2;
}

export interface ReplayStudioMomentV2 {
  tick: number;
  kind: ReplayMomentKindV2;
  title: string;
  summary: string;
  teamIds: string[];
}

export interface ReplayStudioViewV2 {
  matchId: string;
  createdAt: string;
  modeName: string;
  mapId: string;
  participants: ReplayStudioParticipantV2[];
  result: {
    winningTeamIds: string[];
    reason: string;
    ticks: number;
  };
  moments: ReplayStudioMomentV2[];
  advancedSettings: {
    seed: number;
    maxTicks: number;
    engineVersion: string;
  };
}

export function createReplayStudioViewV2(bundle: MatchBundleV2): ReplayStudioViewV2 {
  assertVerified(bundle);
  const teams = new Map(bundle.config.teams.map((team) => [team.teamId, team]));
  const vehicles = new Map(bundle.contentSnapshot.vehicles.map((vehicle) => [vehicle.id, vehicle.displayName]));
  const weapons = new Map(bundle.contentSnapshot.weapons.map((weapon) => [weapon.id, weapon.displayName]));
  const winners = new Set(bundle.result.winningTeamIds);
  const modeName = bundle.contentSnapshot.modes.find((mode) => mode.id === bundle.config.modeId)?.displayName
    ?? bundle.config.modeId;

  const participants = bundle.config.teams.map((team) => ({
    teamId: team.teamId,
    displayName: team.displayName,
    vehicleName: vehicles.get(team.loadout.vehicleId) ?? team.loadout.vehicleId,
    weaponName: weapons.get(team.loadout.weaponIds[0] ?? '') ?? team.loadout.weaponIds[0] ?? '未装备',
    outcome: outcomeFor(team, winners),
  }));
  const moments: ReplayStudioMomentV2[] = [{
    tick: 0,
    kind: 'start',
    title: '比赛开始',
    summary: `${participants.map((participant) => participant.displayName).join(' vs ')} · ${modeName}`,
    teamIds: participants.map((participant) => participant.teamId),
  }];
  for (const event of bundle.events) {
    const moment = eventToMoment(event, teams);
    if (moment) moments.push(moment);
  }
  if (!moments.some((moment) => moment.kind === 'result')) {
    moments.push(resultMoment(bundle, teams));
  }

  return {
    matchId: bundle.config.matchId,
    createdAt: bundle.createdAt,
    modeName,
    mapId: bundle.config.mapId,
    participants,
    result: {
      winningTeamIds: [...bundle.result.winningTeamIds],
      reason: bundle.result.reason,
      ticks: bundle.result.ticks,
    },
    moments,
    advancedSettings: {
      seed: bundle.config.seed,
      maxTicks: bundle.config.maxTicks,
      engineVersion: bundle.engineVersion,
    },
  };
}

export function seekReplayCheckpointV2(bundle: MatchBundleV2, tick: number): StateCheckpointV2 {
  assertVerified(bundle);
  if (!Number.isSafeInteger(tick) || tick < 0 || tick > bundle.result.ticks) {
    throw new Error(`Invalid replay tick: ${tick}`);
  }
  let selected: StateCheckpointV2 | undefined;
  for (const checkpoint of bundle.checkpoints) {
    if (checkpoint.tick > tick) break;
    selected = checkpoint;
  }
  if (!selected) throw new Error(`Replay checkpoint unavailable at tick ${tick}`);
  return structuredClone(selected);
}

function eventToMoment(
  event: EventRecordV2,
  teams: ReadonlyMap<string, MatchTeamConfigV2>,
): ReplayStudioMomentV2 | null {
  if (event.type === 'hit') {
    const shooter = textValue(event.payload.shooterTeamId);
    const victim = textValue(event.payload.victimTeamId);
    const damage = numberValue(event.payload.damage);
    const impactZone = impactZoneName(textValue(event.payload.impactZone));
    return {
      tick: event.tick,
      kind: 'damage',
      title: `${teamName(teams, shooter)} 命中 ${teamName(teams, victim)}`,
      summary: `${impactZone}受击 · ${damage} 点伤害`,
      teamIds: [shooter, victim].filter(Boolean),
    };
  }
  if (event.type === 'destroyed') {
    const teamId = textValue(event.payload.teamId);
    return {
      tick: event.tick,
      kind: 'destruction',
      title: `${teamName(teams, teamId)} 被摧毁`,
      summary: '该单位已退出战斗',
      teamIds: teamId ? [teamId] : [],
    };
  }
  if (event.type === 'match-ended') {
    const winningTeamIds = stringArrayValue(event.payload.winningTeamIds);
    return {
      tick: event.tick,
      kind: 'result',
      title: '比赛结束',
      summary: winningTeamIds.length === 0
        ? '双方战成平局'
        : `${winningTeamIds.map((teamId) => teamName(teams, teamId)).join('、')} 获胜`,
      teamIds: winningTeamIds,
    };
  }
  if (['bot-load-failure', 'bot-timeout', 'bot-error', 'invalid-action'].includes(event.type)) {
    const teamId = textValue(event.payload.teamId);
    return {
      tick: event.tick,
      kind: 'system',
      title: `${teamName(teams, teamId)} 出现运行异常`,
      summary: systemEventName(event.type),
      teamIds: teamId ? [teamId] : [],
    };
  }
  return null;
}

function resultMoment(
  bundle: MatchBundleV2,
  teams: ReadonlyMap<string, MatchTeamConfigV2>,
): ReplayStudioMomentV2 {
  return {
    tick: bundle.result.ticks,
    kind: 'result',
    title: '比赛结束',
    summary: bundle.result.winningTeamIds.length === 0
      ? '双方战成平局'
      : `${bundle.result.winningTeamIds.map((teamId) => teamName(teams, teamId)).join('、')} 获胜`,
    teamIds: [...bundle.result.winningTeamIds],
  };
}

function outcomeFor(
  team: MatchTeamConfigV2,
  winners: ReadonlySet<string>,
): ReplayParticipantOutcomeV2 {
  if (winners.size === 0) return 'draw';
  return winners.has(team.teamId) ? 'winner' : 'defeated';
}

function teamName(teams: ReadonlyMap<string, MatchTeamConfigV2>, teamId: string): string {
  return teams.get(teamId)?.displayName ?? (teamId || '未知队伍');
}

function impactZoneName(zone: string): string {
  return zone === 'front' ? '正面' : zone === 'rear' ? '后方' : zone === 'side' ? '侧面' : '未知方向';
}

function systemEventName(type: string): string {
  if (type === 'bot-load-failure') return 'Agent 加载失败';
  if (type === 'bot-timeout') return 'Agent 响应超时';
  if (type === 'bot-error') return 'Agent 执行出错';
  return 'Agent 返回了无效操作';
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function assertVerified(bundle: MatchBundleV2): void {
  const verification = verifyMatchBundleV2(bundle);
  if (!verification.ok) {
    throw new Error(`Replay integrity verification failed: ${verification.issues.map((issue) => issue.code).join(', ')}`);
  }
}
