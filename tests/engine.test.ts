import { describe, expect, it } from 'vitest';
import { createGame, forceFinish, step, validateAction } from '../src/core/engine.js';
import { MAP_PILLARS, MAP_STANDARD, buildObstacleGrid } from '../src/core/maps.js';
import { DEFAULT_RULES, DIRS, dirDiff, turnDir } from '../src/core/constants.js';
import type { GameEvent, TankAction } from '../src/core/types.js';
import { IDLE_ACTION } from '../src/core/types.js';

const idle: TankAction = { ...IDLE_ACTION };
const act = (o: Partial<TankAction>): TankAction => ({ ...IDLE_ACTION, ...o });

function mk(mapId = 'standard') {
  return createGame(mapId, ['A', 'B']);
}

/** 把坦克摆到指定位置（绕过出生点，用于构造测试场景） */
function place(state: ReturnType<typeof mk>, i: 0 | 1, x: number, y: number, dirBody = 2, dirTurret = dirBody) {
  const t = state.tanks[i]!;
  t.x = x;
  t.y = y;
  t.dirBody = dirBody as 0;
  t.dirTurret = dirTurret as 0;
}

describe('constants', () => {
  it('dirDiff 计算最短角差', () => {
    expect(dirDiff(2, 2)).toBe(0);
    expect(dirDiff(2, 3)).toBe(1);
    expect(dirDiff(2, 1)).toBe(-1);
    expect(dirDiff(0, 4)).toBe(4); // N → S 顺时针 4 步（也可逆时针 4）
    expect(dirDiff(1, 7)).toBe(-2); // NE → NW 最短为逆时针 2 步（经 N）
  });

  it('turnDir 环绕', () => {
    expect(turnDir(7, 1)).toBe(0);
    expect(turnDir(0, -1)).toBe(7);
  });
});

describe('engine: 移动与碰撞', () => {
  it('沿车体朝向前进/后退', () => {
    const s = mk();
    place(s, 0, 10, 10, 2); // 朝东
    place(s, 1, 25, 11, 6);
    step(s, [act({ throttle: 1 }), idle]);
    expect(s.tanks[0]).toMatchObject({ x: 11, y: 10 });
    step(s, [act({ throttle: -1 }), idle]);
    expect(s.tanks[0]).toMatchObject({ x: 10, y: 10 });
  });

  it('转向后同 tick 生效（先转后动）', () => {
    const s = mk();
    place(s, 0, 10, 10, 2); // 朝东
    place(s, 1, 25, 11, 6);
    // bodyTurn +1 → 朝 SE(3)，然后前进
    step(s, [act({ throttle: 1, bodyTurn: 1 }), idle]);
    expect(s.tanks[0]!.dirBody).toBe(3);
    expect(s.tanks[0]).toMatchObject({ x: 11, y: 11 }); // SE 对角
  });

  it('撞墙/障碍/对方坦克时不动', () => {
    const s = mk();
    // 障碍 (7,5,3,2)：格 (7..9, 5..6)
    place(s, 0, 6, 5, 2); // 朝东，正前方 (7,5) 是障碍
    place(s, 1, 25, 11, 6);
    const events = step(s, [act({ throttle: 1 }), idle]);
    expect(s.tanks[0]).toMatchObject({ x: 6, y: 5 });
    expect(events.some((e) => e.type === 'moveBlocked')).toBe(true);

    // 撞对方坦克
    const s2 = mk();
    place(s2, 0, 10, 10, 2);
    place(s2, 1, 11, 10, 6);
    step(s2, [act({ throttle: 1 }), idle]);
    expect(s2.tanks[0]).toMatchObject({ x: 10, y: 10 });

    // 出界
    const s3 = mk();
    place(s3, 0, 0, 0, 6); // 朝西，出界
    place(s3, 1, 25, 11, 6);
    step(s3, [act({ throttle: 1 }), idle]);
    expect(s3.tanks[0]).toMatchObject({ x: 0, y: 0 });
  });
});

describe('engine: 开火与炮弹', () => {
  it('开火生成炮弹，伤害 34，命中后消失', () => {
    const s = mk();
    place(s, 0, 10, 10, 2, 2); // 炮塔朝东
    place(s, 1, 14, 10, 6); // 同行，正东 4 格
    step(s, [act({ fire: true }), idle]);
    expect(s.bullets.length).toBe(1);
    expect(s.bullets[0]).toMatchObject({ x: 10, y: 10, dir: 2, ownerId: 0 });
    expect(s.tanks[0]!.cooldown).toBe(DEFAULT_RULES.fireCooldown);

    // t+1：炮弹走 2 格 → (12,10)
    step(s, [idle, idle]);
    expect(s.bullets[0]).toMatchObject({ x: 12, y: 10 });
    // t+2：炮弹到 (14,10) 命中坦克 1
    const events = step(s, [idle, idle]);
    expect(s.bullets.length).toBe(0);
    expect(s.tanks[1]!.hp).toBe(100 - DEFAULT_RULES.bulletDamage);
    const hit = events.find((e) => e.type === 'hit') as Extract<GameEvent, { type: 'hit' }>;
    expect(hit).toMatchObject({ victimId: 1, shooterId: 0, damage: DEFAULT_RULES.bulletDamage });
  });

  it('冷却期间开火被忽略，冷却按 tick 衰减', () => {
    const s = mk();
    place(s, 0, 10, 20, 2, 2); // y=20 行无障碍，炮弹不会中途消失
    place(s, 1, 25, 11, 6);
    step(s, [act({ fire: true }), idle]); // t0 开火, cd=4
    step(s, [act({ fire: true }), idle]); // t1: cd 衰减 4→3，仍 >0
    expect(s.bullets.length).toBe(1);
    step(s, [act({ fire: true }), idle]); // t2: cd→2
    step(s, [act({ fire: true }), idle]); // t3: cd→1
    step(s, [act({ fire: true }), idle]); // t4: cd→0 → 可以再次开火
    expect(s.bullets.length).toBe(2);
    expect(s.tanks[0]!.violations).toBe(0); // 冷却开火不算违规
  });

  it('炮弹无视发射者（穿过），只命中对方', () => {
    const s = mk();
    place(s, 0, 10, 10, 2, 2); // 朝东开火
    place(s, 1, 25, 11, 6);
    step(s, [act({ fire: true, throttle: 1 }), idle]); // 同 tick 前进，下一 tick 追进自己弹道
    // 炮弹从 (10,10) 飞出；坦克 0 前进到 (11,10)
    expect(s.tanks[0]).toMatchObject({ x: 11, y: 10 });
    const events = step(s, [idle, idle]); // 炮弹子步经过 (11,10)（发射者）→ 穿过
    expect(s.tanks[0]!.hp).toBe(100);
    expect(events.some((e) => e.type === 'hit' && e.victimId === 0)).toBe(false);
    expect(s.bullets.length).toBe(1);
  });

  it('炮弹撞障碍消失', () => {
    const s = mk();
    place(s, 0, 5, 5, 2, 2); // 朝东，障碍 (7..9, 5..6) 在前方
    place(s, 1, 25, 11, 6);
    step(s, [act({ fire: true }), idle]); // 炮弹 (5,5)
    step(s, [idle, idle]); // 走到 (7,5)? 子步 1→(6,5) 子步 2→(7,5) 撞障碍
    expect(s.bullets.length).toBe(0);
  });

  it('移动可躲避炮弹（先移动后判定）', () => {
    const s = mk();
    place(s, 0, 10, 10, 2, 2);
    place(s, 1, 14, 10, 6, 6); // 坦克1 炮塔朝西(6)
    step(s, [act({ fire: true }), act({ fire: true })]); // 双方炮弹
    expect(s.bullets.length).toBe(2);
    // 坦克1 向南移动避开西向弹道
    place(s, 1, 14, 10, 4, 6);
    step(s, [idle, act({ throttle: 1 })]); // 坦克1 → (14,11)
    // 炮弹0 从(10,10)向东：(12,10)；炮弹1 从(14,10)向西：(12,10) 互相穿过
    expect(s.bullets.length).toBe(2);
    expect(s.tanks[1]).toMatchObject({ x: 14, y: 11, hp: 100 });
  });
});

describe('engine: 胜负', () => {
  it('三发击毁对手获胜', () => {
    const s = mk();
    place(s, 0, 10, 10, 2, 2);
    place(s, 1, 14, 10, 6);
    let guard = 0;
    while (!s.finished && guard++ < 60) {
      step(s, [act({ fire: true }), idle]);
      step(s, [idle, idle]);
      step(s, [idle, idle]);
    }
    expect(s.finished).toBe(true);
    expect(s.winner).toBe(0);
    expect(s.endReason).toBe('destroyed');
  });

  it('maxTicks 打满按 HP 判定，HP 相同平局', () => {
    const s = createGame('standard', ['A', 'B'], { maxTicks: 10 });
    let guard = 0;
    while (!s.finished && guard++ < 100) step(s, [idle, idle]);
    expect(s.finished).toBe(true);
    expect(s.winner).toBe(-1);
    expect(s.endReason).toBe('maxTicks');
  });

  it('forceFinish 由 runner 使用（违规判负）', () => {
    const s = mk();
    forceFinish(s, 1, 'violations');
    expect(s.finished).toBe(true);
    expect(s.winner).toBe(1);
  });
});

describe('engine: validateAction 钳制', () => {
  it('非对象返回 idle 且 invalid', () => {
    expect(validateAction(null).valid).toBe(false);
    expect(validateAction(undefined).valid).toBe(false);
    expect(validateAction(42).valid).toBe(false);
    expect(validateAction([1, 2]).valid).toBe(false);
    expect(validateAction('go').valid).toBe(false);
  });

  it('数值越界被截断，缺省按 0/false', () => {
    const { action } = validateAction({ throttle: 5, bodyTurn: -3, turretTurn: 0.7, fire: 1 });
    expect(action).toEqual({ throttle: 1, bodyTurn: -1, turretTurn: 0, fire: true });
    const { action: a2 } = validateAction({});
    expect(a2).toEqual(idle);
  });
});

describe('engine: 确定性', () => {
  it('相同动作序列产生完全相同的状态与事件', () => {
    const run = () => {
      const s = createGame('pillars', ['A', 'B'], { maxTicks: 400 });
      const actions: TankAction[] = [
        act({ throttle: 1, fire: true }),
        act({ bodyTurn: 1, turretTurn: -1 }),
        act({ throttle: -1, fire: true }),
        act({ turretTurn: 1 }),
        idle,
        act({ throttle: 1, bodyTurn: -1, fire: true }),
      ];
      const eventLog: GameEvent[] = [];
      let i = 0;
      while (!s.finished) {
        const a = actions[i % actions.length]!;
        eventLog.push(...step(s, [a, actions[(i + 3) % actions.length]!]));
        i++;
      }
      return { state: s, eventLog };
    };
    const r1 = run();
    const r2 = run();
    expect(r1.state.tick).toBeGreaterThan(0);
    expect(r1.state).toEqual(r2.state);
    expect(r1.eventLog).toEqual(r2.eventLog);
  });

  it('地图对称性：出生点与障碍中心对称', () => {
    for (const map of [MAP_STANDARD, MAP_PILLARS]) {
      const grid = buildObstacleGrid(map);
      const [a, b] = map.spawns;
      expect(a.x + b.x).toBe(map.width - 1);
      expect(a.y + b.y).toBe(map.height - 1);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          expect(grid[y]![x]).toBe(grid[map.height - 1 - y]![map.width - 1 - x]);
        }
      }
    }
  });
});
