// 坦克竞技场 —— tick 结算引擎
//
// 纯同步、确定性、无 IO、无随机。相同的 (初始状态, 动作序列) 永远产生相同的结果。
//
// 每个 tick 的结算顺序（与 docs/tank-spec.md 保持一致，改动必须同步文档）：
//   0. 冷却衰减（所有存活坦克 cooldown 减 1，最低 0）
//   1. 转向（车体、炮塔；转向后本 tick 即按新朝向移动）
//   2. 移动（按坦克 id 升序尝试，目标格不可进入则原地不动）
//   3. 炮弹推进（按炮弹 id 升序，逐子步检查出界/障碍/命中）
//   4. 开火（冷却中静默忽略；炮弹生成于坦克当前格，下一 tick 开始飞行）
//   5. 死亡清算
//   6. 回合推进与回合上限判定

import { DEFAULT_RULES, dirDelta, turnDir } from './constants.js';
import { buildObstacleGrid, getMap } from './maps.js';
import type {
  EndReason,
  GameEvent,
  GameState,
  Rules,
  TankAction,
  TankState,
  Winner,
} from './types.js';
import { IDLE_ACTION } from './types.js';

const gridCache = new Map<string, boolean[][]>();

function gridFor(mapId: string): boolean[][] {
  let g = gridCache.get(mapId);
  if (!g) {
    g = buildObstacleGrid(getMap(mapId));
    gridCache.set(mapId, g);
  }
  return g;
}

export function createGame(
  mapId: string,
  names: [string, string],
  rulesOverride: Partial<Rules> = {},
): GameState {
  const map = getMap(mapId);
  const rules: Rules = {
    ...DEFAULT_RULES,
    ...rulesOverride,
    fieldWidth: map.width,
    fieldHeight: map.height,
  };
  if (rules.bulletSpeed < 1) throw new Error('bulletSpeed 必须 >= 1');
  const mkTank = (i: 0 | 1): TankState => {
    const s = map.spawns[i]!;
    return {
      id: i,
      name: names[i] ?? `Tank${i}`,
      x: s.x,
      y: s.y,
      hp: rules.maxHp,
      dirBody: s.dir,
      dirTurret: s.dir,
      cooldown: 0,
      alive: true,
      violations: 0,
    };
  };
  return {
    mapId,
    rules,
    tick: 0,
    tanks: [mkTank(0), mkTank(1)],
    bullets: [],
    nextBulletId: 1,
    finished: false,
    winner: null,
    endReason: null,
  };
}

function cellEnterable(state: GameState, grid: boolean[][], x: number, y: number): boolean {
  const { rules } = state;
  if (x < 0 || y < 0 || x >= rules.fieldWidth || y >= rules.fieldHeight) return false;
  if (grid[y]![x]) return false;
  for (const t of state.tanks) {
    if (t.alive && t.x === x && t.y === y) return false;
  }
  return true;
}

function endGame(state: GameState, events: GameEvent[], winner: Winner, reason: Exclude<EndReason, null>): void {
  state.finished = true;
  state.winner = winner;
  state.endReason = reason;
  events.push({ type: 'end', tick: state.tick, winner, reason });
}

/** 结算一个 tick。直接修改 state，返回本 tick 的事件列表。 */
export function step(state: GameState, actions: readonly [TankAction, TankAction]): GameEvent[] {
  if (state.finished) return [];
  const events: GameEvent[] = [];
  const { rules, tick } = state;
  const grid = gridFor(state.mapId);

  // 0. 冷却衰减
  for (const t of state.tanks) {
    if (t.alive) t.cooldown = Math.max(0, t.cooldown - 1);
  }

  // 1. 转向
  state.tanks.forEach((t, i) => {
    if (!t.alive) return;
    const a = actions[i]!;
    if (a.bodyTurn !== 0) t.dirBody = turnDir(t.dirBody, a.bodyTurn);
    if (a.turretTurn !== 0) t.dirTurret = turnDir(t.dirTurret, a.turretTurn);
  });

  // 2. 移动
  state.tanks.forEach((t, i) => {
    if (!t.alive) return;
    const a = actions[i]!;
    if (a.throttle === 0) return;
    const [dx, dy] = dirDelta(t.dirBody);
    const nx = t.x + dx * a.throttle;
    const ny = t.y + dy * a.throttle;
    if (!cellEnterable(state, grid, nx, ny)) {
      events.push({ type: 'moveBlocked', tick, tankId: t.id, x: nx, y: ny });
      return;
    }
    t.x = nx;
    t.y = ny;
  });

  // 3. 炮弹推进（bullets 列表按生成顺序即 id 升序）
  const flying = [];
  for (const b of state.bullets) {
    let alive = true;
    let { x, y } = b;
    const [dx, dy] = dirDelta(b.dir);
    for (let s = 0; s < rules.bulletSpeed && alive; s++) {
      x += dx;
      y += dy;
      const inField =
        x >= 0 && y >= 0 && x < rules.fieldWidth && y < rules.fieldHeight;
      if (!inField || grid[y]![x]) {
        events.push({ type: 'bulletBlocked', tick, bulletId: b.id, x, y });
        alive = false;
        break;
      }
      // 炮弹无视发射者（可穿过），只会命中对方坦克
      const victim = state.tanks.find((t) => t.alive && t.id !== b.ownerId && t.x === x && t.y === y);
      if (victim) {
        victim.hp -= rules.bulletDamage;
        events.push({
          type: 'hit',
          tick,
          bulletId: b.id,
          shooterId: b.ownerId,
          victimId: victim.id,
          x,
          y,
          damage: rules.bulletDamage,
          victimHp: victim.hp,
        });
        alive = false;
        break;
      }
    }
    if (alive) {
      b.x = x;
      b.y = y;
      flying.push(b);
    }
  }
  state.bullets = flying;

  // 4. 开火
  state.tanks.forEach((t, i) => {
    if (!t.alive) return;
    const a = actions[i]!;
    if (!a.fire) return;
    if (t.cooldown > 0) return; // 冷却中：静默忽略，不算违规
    state.bullets.push({
      id: state.nextBulletId++,
      ownerId: t.id,
      x: t.x,
      y: t.y,
      dir: t.dirTurret,
    });
    t.cooldown = rules.fireCooldown;
    events.push({ type: 'fire', tick, tankId: t.id, x: t.x, y: t.y, dir: t.dirTurret });
  });

  // 5. 死亡清算
  for (const t of state.tanks) {
    if (t.alive && t.hp <= 0) {
      t.alive = false;
      events.push({ type: 'die', tick, tankId: t.id });
    }
  }
  const aliveCount = state.tanks.filter((t) => t.alive).length;
  if (aliveCount === 0) {
    endGame(state, events, -1, 'destroyed');
  } else if (aliveCount === 1) {
    const survivor = state.tanks.find((t) => t.alive)!;
    endGame(state, events, survivor.id, 'destroyed');
  }

  // 6. 回合推进与上限
  if (!state.finished) {
    state.tick++;
    if (state.tick >= rules.maxTicks) {
      const [a, b] = state.tanks;
      const winner: Winner = a!.hp > b!.hp ? 0 : b!.hp > a!.hp ? 1 : -1;
      endGame(state, events, winner, 'maxTicks');
    }
  }

  return events;
}

/** runner 专用：外部强制结束对局（如违规达上限、沙盒崩溃）。 */
export function forceFinish(
  state: GameState,
  winner: Winner,
  reason: Exclude<EndReason, null>,
): GameEvent[] {
  if (state.finished) return [];
  const events: GameEvent[] = [];
  endGame(state, events, winner, reason);
  return events;
}

function clampTurn(v: unknown): -1 | 0 | 1 {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, Math.trunc(v))) as -1 | 0 | 1;
}

/**
 * 把 bot 返回的任意值钳制成合法动作。
 * 宽容策略：字段缺失/类型错误按 0/false 处理；数值越界截断。
 * 只有当返回值根本不是对象时才判定 invalid（计违规）。
 */
export function validateAction(raw: unknown): { action: TankAction; valid: boolean } {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { action: { ...IDLE_ACTION }, valid: false };
  }
  const r = raw as Record<string, unknown>;
  return {
    action: {
      throttle: clampTurn(r.throttle),
      bodyTurn: clampTurn(r.bodyTurn),
      turretTurn: clampTurn(r.turretTurn),
      // 宽容：fire: 1 / "true" 等真值视为开火
      fire: !!r.fire,
    },
    valid: true,
  };
}
