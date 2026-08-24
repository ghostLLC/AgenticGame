import { pathToFileURL } from 'node:url';
import type { BotArtifactSnapshotV2, ContentSnapshotV2, MapSnapshotV2 } from '../core/v2/content.js';
import { GameplayEngineV2, type GameplayEventV2 } from '../core/v2/gameplay-engine.js';
import type { JsonObject } from '../core/v2/json.js';
import { assertMatchConfigV2, type MatchConfigV2 } from '../core/v2/match-config.js';
import { IDLE_ACTION, type TankAction } from '../core/types.js';
import {
  createMatchBundleV2,
  type ActionRecordV2,
  type EventRecordV2,
  type LogRecordV2,
  type MatchBundleV2,
  type StateCheckpointInputV2,
} from '../replay/v2.js';
import { BotRunner, getWorkerPath } from '../runtime/sandbox.js';
import { fullCodeHash } from './v2-adapter.js';
import { validateAction } from '../core/engine.js';

const ENGINE_VERSION = '0.2.0';
const DEFAULT_TICK_BUDGET_MS = 30;
const DEFAULT_MAX_VIOLATIONS = 30;
const CRASH_SILENCE_TICKS = 5;

export interface GameplayBotSpecV2 {
  path?: string;
  code: string;
}

export interface GameplayMatchConfigV2 {
  matchConfig: MatchConfigV2;
  contentSnapshot: ContentSnapshotV2;
  mapSnapshot: MapSnapshotV2;
  bots: readonly [GameplayBotSpecV2, GameplayBotSpecV2];
  createdAt?: string;
  tickBudgetMs?: number;
  maxViolations?: number;
  collectLogs?: boolean;
  onProgress?: (tick: number, maxTicks: number) => void;
  onBundle?: (bundle: MatchBundleV2) => void | Promise<void>;
}

export interface GameplayMatchSummaryV2 {
  winningTeamIds: string[];
  reason: string;
  ticks: number;
  hp: [number, number];
  ammunition: [number, number];
  violations: [number, number];
}

export interface GameplayMatchOutputV2 {
  summary: GameplayMatchSummaryV2;
  bundle: MatchBundleV2;
}

export async function runMatchV2(input: GameplayMatchConfigV2): Promise<GameplayMatchOutputV2> {
  const matchConfig = assertMatchConfigV2(input.matchConfig);
  if (matchConfig.teams.length !== 2) throw new Error('runMatchV2 首期仅支持恰好两个队伍');
  const createdAt = input.createdAt ?? new Date().toISOString();
  const tickBudgetMs = input.tickBudgetMs ?? DEFAULT_TICK_BUDGET_MS;
  const maxViolations = input.maxViolations ?? DEFAULT_MAX_VIOLATIONS;
  const collectLogs = input.collectLogs ?? true;
  const artifacts = createArtifacts(matchConfig, input.bots);
  const engine = new GameplayEngineV2(matchConfig, input.contentSnapshot, input.mapSnapshot);

  const runners = ([0, 1] as const).map((index) => {
    const team = matchConfig.teams[index]!;
    const tank = engine.state.tanks[index];
    const vehicle = input.contentSnapshot.vehicles.find((item) => item.id === tank.vehicleId)!;
    const weapon = input.contentSnapshot.weapons.find((item) => item.id === tank.weaponId)!;
    return BotRunner.create({
      code: input.bots[index].code,
      botIndex: index,
      seed: hashSeed(matchConfig.seed, index),
      ctx: {
        schemaVersion: 2,
        teamId: team.teamId,
        field: { width: input.mapSnapshot.width, height: input.mapSnapshot.height },
        terrainCells: input.mapSnapshot.terrainCells,
        vehicle,
        weapon,
        rules: { maxTicks: matchConfig.maxTicks, tickBudgetMs, maxViolations },
      },
      workerUrl: pathToFileURL(getWorkerPath()),
    });
  }) as [BotRunner, BotRunner];

  const actions: ActionRecordV2[] = [];
  const events: EventRecordV2[] = [];
  const checkpoints: StateCheckpointInputV2[] = [];
  const logs: LogRecordV2[] = [];
  checkpoints.push({ tick: 0, state: engine.snapshot() });

  try {
    const initResults = await Promise.all([runners[0].init(5000), runners[1].init(5000)]);
    const failedIndex = initResults.findIndex((result) => !result.ok);
    if (failedIndex >= 0) {
      const loser = failedIndex as 0 | 1;
      const winner = (1 - loser) as 0 | 1;
      const result = initResults[loser]!;
      events.push({
        tick: 0,
        type: 'bot-load-failure',
        payload: {
          teamId: matchConfig.teams[loser]!.teamId,
          message: result.ok ? 'unknown' : result.error.slice(0, 200),
        },
      });
      appendEngineEvents(events, engine.forceFinish([matchConfig.teams[winner]!.teamId], 'load-failure'));
      checkpoints[0] = { tick: engine.state.tick, state: engine.snapshot() };
      return await finalize();
    }

    while (!engine.state.finished) {
      const tick = engine.state.tick;
      input.onProgress?.(tick, matchConfig.maxTicks);
      const outcomes = await Promise.all([
        runners[0].tick(tick, engine.viewFor(0), tickBudgetMs),
        runners[1].tick(tick, engine.viewFor(1), tickBudgetMs),
      ]);
      const applied: [TankAction, TankAction] = [{ ...IDLE_ACTION }, { ...IDLE_ACTION }];
      const violated: [boolean, boolean] = [false, false];

      outcomes.forEach((outcome, indexValue) => {
        const index = indexValue as 0 | 1;
        const teamId = matchConfig.teams[index]!.teamId;
        if (outcome.kind === 'timeout') {
          violated[index] = true;
          events.push({ tick, type: 'bot-timeout', payload: { teamId } });
          return;
        }
        if (outcome.kind === 'error') {
          violated[index] = true;
          appendLogs(logs, tick, teamId, outcome.logs, collectLogs);
          events.push({ tick, type: 'bot-error', payload: { teamId, message: outcome.message.slice(0, 200) } });
          return;
        }
        appendLogs(logs, tick, teamId, outcome.logs, collectLogs);
        const validated = validateAction(outcome.action);
        applied[index] = validated.action;
        if (!validated.valid) {
          violated[index] = true;
          events.push({ tick, type: 'invalid-action', payload: { teamId } });
        }
      });

      for (const index of [0, 1] as const) {
        if (violated[index]) engine.state.tanks[index].violations += 1;
        actions.push({
          tick,
          actorId: matchConfig.teams[index]!.teamId,
          action: { ...applied[index] } as unknown as JsonObject,
        });
      }

      const crashed = ([0, 1] as const).map((index) =>
        !runners[index].isTerminated && tick - runners[index].aliveTick > CRASH_SILENCE_TICKS,
      ) as [boolean, boolean];
      if (crashed[0] || crashed[1]) {
        for (const index of [0, 1] as const) if (crashed[index]) runners[index].terminate();
        const winners = crashed[0] === crashed[1]
          ? []
          : [matchConfig.teams[crashed[0] ? 1 : 0]!.teamId];
        appendEngineEvents(events, engine.forceFinish(winners, 'crash'));
      } else {
        const overLimit = ([0, 1] as const).map((index) =>
          engine.state.tanks[index].violations >= maxViolations,
        ) as [boolean, boolean];
        if (overLimit[0] || overLimit[1]) {
          const winners = overLimit[0] === overLimit[1]
            ? []
            : [matchConfig.teams[overLimit[0] ? 1 : 0]!.teamId];
          appendEngineEvents(events, engine.forceFinish(winners, 'violations'));
        } else {
          appendEngineEvents(events, engine.step(applied));
        }
      }
      checkpoints.push({ tick: engine.state.tick, state: engine.snapshot() });
    }
    return await finalize();
  } finally {
    runners[0].terminate();
    runners[1].terminate();
  }

  async function finalize(): Promise<GameplayMatchOutputV2> {
    const [a, b] = engine.state.tanks;
    const summary: GameplayMatchSummaryV2 = {
      winningTeamIds: [...engine.state.winningTeamIds],
      reason: engine.state.endReason ?? 'unknown',
      ticks: engine.state.tick,
      hp: [a.hp, b.hp],
      ammunition: [a.ammunition, b.ammunition],
      violations: [a.violations, b.violations],
    };
    const bundle = createMatchBundleV2({
      engineVersion: ENGINE_VERSION,
      createdAt,
      config: matchConfig,
      mapSnapshot: input.mapSnapshot,
      contentSnapshot: input.contentSnapshot,
      botArtifacts: artifacts,
      actions,
      events,
      checkpoints,
      logs,
      result: {
        winningTeamIds: [...summary.winningTeamIds],
        reason: summary.reason,
        ticks: summary.ticks,
      },
    });
    await input.onBundle?.(bundle);
    return { summary, bundle };
  }
}

function createArtifacts(
  config: MatchConfigV2,
  bots: readonly [GameplayBotSpecV2, GameplayBotSpecV2],
): BotArtifactSnapshotV2[] {
  const artifacts: BotArtifactSnapshotV2[] = [];
  for (const index of [0, 1] as const) {
    const team = config.teams[index]!;
    const hash = fullCodeHash(bots[index].code);
    if (hash !== team.bot.codeHash) throw new Error(`Bot source hash mismatch: ${team.teamId}`);
    const artifact: BotArtifactSnapshotV2 = {
      artifactId: team.bot.artifactId,
      version: team.bot.version,
      codeHash: hash,
      language: 'javascript',
      entryPoint: bots[index].path ?? 'inline',
      source: bots[index].code,
    };
    const existing = artifacts.find((item) =>
      item.artifactId === artifact.artifactId && item.version === artifact.version,
    );
    if (existing) {
      if (existing.codeHash !== artifact.codeHash || existing.source !== artifact.source) {
        throw new Error(`Bot artifact identity collision: ${artifact.artifactId}@${artifact.version}`);
      }
      continue;
    }
    artifacts.push(artifact);
  }
  return artifacts;
}

function appendEngineEvents(target: EventRecordV2[], source: readonly GameplayEventV2[]): void {
  for (const event of source) {
    const { tick, type, ...payload } = event;
    target.push({ tick, type, payload: payload as unknown as JsonObject });
  }
}

function appendLogs(
  target: LogRecordV2[],
  tick: number,
  sourceId: string,
  messages: readonly string[],
  enabled: boolean,
): void {
  if (!enabled) return;
  for (const message of messages) target.push({ tick, sourceId, level: 'debug', message });
}

function hashSeed(seed: number, index: 0 | 1): number {
  let hash = 0x9e3779b9 ^ (seed >>> 0);
  hash = Math.imul(hash ^ (index + 1), 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}
