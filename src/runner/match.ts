// 坦克竞技场 —— 对局驱动器
//
// 把三件事串起来：确定性内核（engine）+ 双方沙盒（BotRunner）+ 回放记录。
//
// 每 tick：
//   1. 组装完全信息快照，并行发给两个 bot（各自时间预算）
//   2. 超时/异常/非法返回 → idle + 违规计数；违规达上限判负
//   3. worker 卡死（连续多个 tick 无任何响应）→ terminate + 判负
//   4. engine.step 结算，快照与事件写入回放

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createGame, forceFinish, step, validateAction } from '../core/engine.js';
import { getMap } from '../core/maps.js';
import type {
  BattleView,
  GameEvent,
  GameState,
  Rules,
  Rect,
  TankAction,
  Winner,
} from '../core/types.js';
import { IDLE_ACTION } from '../core/types.js';
import { snapshotBullets, snapshotTanks } from '../replay/format.js';
import type { Replay, ReplayFrame } from '../replay/format.js';
import { BotRunner } from '../runtime/sandbox.js';
import { getWorkerPath } from '../runtime/sandbox.js';

/** 连续这么多 tick worker 无任何响应 → 视为卡死 */
const CRASH_SILENCE_TICKS = 5;

export type BotSpec = { path?: string; code: string; displayName?: string };

export interface MatchConfig {
  botA: BotSpec;
  botB: BotSpec;
  mapId?: string;
  maxTicks?: number;
  seed?: number;
  /** 覆盖每 tick 预算（默认取 rules.tickBudgetMs） */
  tickBudgetMs?: number;
  /** 是否在回放里收集 console 日志 */
  collectLogs?: boolean;
  /** 进度回调 */
  onProgress?: (tick: number, maxTicks: number) => void;
}

export interface MatchSummary {
  winner: Winner;
  reason: string;
  ticks: number;
  hp: [number, number];
  violations: [number, number];
  hits: [number, number];
  fired: [number, number];
  botNames: [string, string];
}

export interface MatchOutput {
  summary: MatchSummary;
  replay: Replay;
}

function hashSeed(seed: number, index: 0 | 1): number {
  // 确定性派生：不同 seed / 不同 index 得到不同序列
  let h = 0x9e3779b9 ^ (seed >>> 0);
  h = Math.imul(h ^ (index + 1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function viewFor(state: GameState, tankId: 0 | 1): BattleView {
  const [a, b] = state.tanks;
  const self = tankId === 0 ? a! : b!;
  const enemy = tankId === 0 ? b! : a!;
  return {
    tick: state.tick,
    field: { width: state.rules.fieldWidth, height: state.rules.fieldHeight },
    self: { ...self },
    enemy: { ...enemy },
    bullets: state.bullets.map((x) => ({ ...x })),
    rules: state.rules,
  };
}

export async function runMatch(cfg: MatchConfig): Promise<MatchOutput> {
  const mapId = cfg.mapId ?? 'standard';
  const map = getMap(mapId);
  const seed = (cfg.seed ?? 42) >>> 0;
  const collectLogs = cfg.collectLogs ?? true;

  const state = createGame(mapId, ['A', 'B'], {
    ...(cfg.maxTicks !== undefined ? { maxTicks: cfg.maxTicks } : {}),
    ...(cfg.tickBudgetMs !== undefined ? { tickBudgetMs: cfg.tickBudgetMs } : {}),
  });
  const rules: Rules = state.rules;
  const obstacles: Rect[] = map.obstacles;
  const ctxBase = {
    field: { width: rules.fieldWidth, height: rules.fieldHeight },
    obstacles,
    rules,
  };

  const mk = (spec: BotSpec, index: 0 | 1) =>
    BotRunner.create({
      code: spec.code,
      botIndex: index,
      seed: hashSeed(seed, index),
      ctx: { ...ctxBase, myId: index },
      workerUrl: pathToFileURL(getWorkerPath()),
    });

  const runnerA = mk(cfg.botA, 0);
  const runnerB = mk(cfg.botB, 1);
  const runners = [runnerA, runnerB] as const;

  const codeHash = (code: string) => createHash('sha256').update(code, 'utf8').digest('hex').slice(0, 16);
  const botInfo = [
    { file: cfg.botA.path ?? 'inline', hash: codeHash(cfg.botA.code) },
    { file: cfg.botB.path ?? 'inline', hash: codeHash(cfg.botB.code) },
  ];

  const frames: ReplayFrame[] = [];
  const summary: MatchSummary = {
    winner: null,
    reason: '',
    ticks: 0,
    hp: [0, 0],
    violations: [0, 0],
    hits: [0, 0],
    fired: [0, 0],
    botNames: ['A', 'B'],
  };

  try {
    // 初始化
    const specs: [BotSpec, BotSpec] = [cfg.botA, cfg.botB];
    const initResults = await Promise.all([runnerA.init(5000), runnerB.init(5000)]);
    const names: [string, string] = ['A', 'B'];
    for (const [i, r] of initResults.entries()) {
      const idx = i as 0 | 1;
      const opponent = (1 - idx) as 0 | 1;
      if (!r.ok) {
        const spec = specs[idx];
        names[idx] = spec.displayName ?? spec.path?.replace(/\.js$/, '') ?? 'inline';
        state.tanks[idx].name = names[idx];
        summary.botNames = names;
        const evs = forceFinish(state, opponent, 'violations');
        frames.push(frameOf(state, evs));
        summary.winner = state.winner;
        summary.reason = `${names[idx]} 加载失败：${r.error}`;
        return finalize();
      }
      names[idx] = specs[idx].displayName ?? r.name;
      state.tanks[idx].name = names[idx];
    }
    summary.botNames = names;

    // 主循环
    while (!state.finished) {
      const t = state.tick;
      cfg.onProgress?.(t, rules.maxTicks);

      const outcomes = await Promise.all([
        runnerA.tick(t, viewFor(state, 0), rules.tickBudgetMs),
        runnerB.tick(t, viewFor(state, 1), rules.tickBudgetMs),
      ]);

      const tickEvents: GameEvent[] = [];
      const actions: [TankAction, TankAction] = [{ ...IDLE_ACTION }, { ...IDLE_ACTION }];
      const tickLogs: [string[], string[]] = [[], []];
      let violationThisTick: [boolean, boolean] = [false, false];

      for (const [i, outcome] of outcomes.entries()) {
        const idx = i as 0 | 1;
        if (outcome.kind === 'timeout') {
          violationThisTick[idx] = true;
          tickEvents.push({ type: 'violation', tick: t, tankId: idx, kind: 'timeout' });
          continue;
        }
        if (outcome.kind === 'error') {
          violationThisTick[idx] = true;
          tickLogs[idx] = outcome.logs;
          tickEvents.push({
            type: 'violation',
            tick: t,
            tankId: idx,
            kind: 'error',
            detail: outcome.message.slice(0, 200),
          });
          continue;
        }
        // ok
        tickLogs[idx] = outcome.logs;
        const { action, valid } = validateAction(outcome.action);
        actions[idx] = action;
        if (!valid) {
          violationThisTick[idx] = true;
          tickEvents.push({ type: 'violation', tick: t, tankId: idx, kind: 'invalidAction' });
        }
      }

      // 违规计数
      for (const idx of [0, 1] as const) {
        if (violationThisTick[idx]) {
          state.tanks[idx].violations += 1;
        }
      }

      // 卡死检测：连续 CRASH_SILENCE_TICKS 个 tick 无任何响应
      let crashed: [boolean, boolean] = [false, false];
      for (const idx of [0, 1] as const) {
        const r = runners[idx];
        if (!r.isTerminated && t - r.aliveTick > CRASH_SILENCE_TICKS) {
          crashed[idx] = true;
        }
      }
      if (crashed[0] || crashed[1]) {
        const evs: GameEvent[] = [];
        if (crashed[0]) runnerA.terminate();
        if (crashed[1]) runnerB.terminate();
        const winner: Winner = crashed[0] && crashed[1] ? -1 : crashed[0] ? 1 : 0;
        evs.push(...forceFinish(state, winner, 'crash'));
        tickEvents.push(...evs);
        frames.push(frameOf(state, tickEvents, tickLogs, collectLogs));
        summary.ticks = state.tick + 1;
        break;
      }

      // 违规达上限判负
      const overLimit = [0, 1].map((i) => state.tanks[i]!.violations >= rules.maxViolations) as [boolean, boolean];
      if (overLimit[0] || overLimit[1]) {
        const winner: Winner = overLimit[0] && overLimit[1] ? -1 : overLimit[0] ? 1 : 0;
        tickEvents.push(...forceFinish(state, winner, 'violations'));
        frames.push(frameOf(state, tickEvents, tickLogs, collectLogs));
        summary.ticks = state.tick + 1;
        break;
      }

      // 正常结算
      const events = step(state, actions);
      tickEvents.push(...events);
      frames.push(frameOf(state, tickEvents, tickLogs, collectLogs));
      summary.ticks = frames.length;

      if (state.finished) break;
    }

    if (!state.finished) {
      // 理论不可达（engine 在 maxTicks 后必然 finished），保险兜底
      forceFinish(state, -1, 'maxTicks');
    }

    summary.winner = state.winner;
    summary.reason = describeReason(state);
    summary.hp = [state.tanks[0]!.hp, state.tanks[1]!.hp];
    summary.violations = [state.tanks[0]!.violations, state.tanks[1]!.violations];
    for (const f of frames) {
      for (const e of f.events) {
        if (e.type === 'hit') summary.hits[e.shooterId] += 1;
        if (e.type === 'fire') summary.fired[e.tankId] += 1;
      }
    }
    return finalize();
  } finally {
    runnerA.terminate();
    runnerB.terminate();
  }

  function frameOf(
    s: GameState,
    events: GameEvent[],
    logs?: [string[], string[]],
    withLogs = false,
  ): ReplayFrame {
    const f: ReplayFrame = {
      tick: s.tick,
      tanks: snapshotTanks(s.tanks),
      bullets: snapshotBullets(s.bullets),
      events,
    };
    if (withLogs && logs && (logs[0]!.length || logs[1]!.length)) f.logs = [[...logs[0]!], [...logs[1]!]];
    return f;
  }

  function describeReason(s: GameState): string {
    switch (s.endReason) {
      case 'destroyed':
        return s.winner === -1 ? '双方同 tick 被击毁，平局' : `坦克 ${s.winner} 击毁对手`;
      case 'maxTicks':
        return s.winner === -1 ? '回合耗尽，HP 相同，平局' : `回合耗尽，坦克 ${s.winner} HP 更高`;
      case 'violations':
        return s.winner === -1 ? '双方违规均达上限' : `对手违规达上限（超时/出错 ${rules.maxViolations} 次）`;
      case 'crash':
        return s.winner === -1 ? '双方沙盒崩溃' : `对手沙盒崩溃（疑似死循环）`;
      default:
        return String(s.endReason);
    }
  }

  function finalize(): MatchOutput {
    summary.hp = [state.tanks[0]!.hp, state.tanks[1]!.hp];
    const replay: Replay = {
      format: 'tank-arena-replay',
      version: 1,
      engineVersion: '0.1.0',
      createdAt: new Date().toISOString(),
      mapId,
      rules,
      seeds: [hashSeed(seed, 0), hashSeed(seed, 1)],
      bots: [
        { name: summary.botNames[0], file: botInfo[0]!.file, codeHash: botInfo[0]!.hash, violations: summary.violations[0] },
        { name: summary.botNames[1], file: botInfo[1]!.file, codeHash: botInfo[1]!.hash, violations: summary.violations[1] },
      ],
      result: { winner: summary.winner, reason: summary.reason as Replay['result']['reason'], ticks: summary.ticks },
      frames,
    };
    // 修正 result.reason：replay 里存机器可读的原因码
    replay.result.reason = state.endReason as Replay['result']['reason'];
    return { summary, replay };
  }
}
