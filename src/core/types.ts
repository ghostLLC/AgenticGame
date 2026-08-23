// 坦克竞技场 —— 核心类型定义
// 内核是纯同步、确定性的：相同输入永远产生相同结果。

/** 方向：0-7，顺时针，0=北(y-1)。每个方向 = 基础角度 45° × dir。 */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 一名坦克在一个 tick 内提交的复合动作。各维度独立，可同时生效。 */
export interface TankAction {
  /** 前进(1)/后退(-1)/静止(0)，沿车体朝向移动 1 格 */
  throttle: -1 | 0 | 1;
  /** 车体转向：左转(-1)/右转(+1)/不动(0)，每次 45° */
  bodyTurn: -1 | 0 | 1;
  /** 炮塔转向：左转(-1)/右转(+1)/不动(0)，独立于车体，每次 45° */
  turretTurn: -1 | 0 | 1;
  /** 是否开火（受冷却限制，冷却中开火无效） */
  fire: boolean;
}

export const IDLE_ACTION: TankAction = {
  throttle: 0,
  bodyTurn: 0,
  turretTurn: 0,
  fire: false,
};

export interface TankState {
  id: 0 | 1;
  /** 由 bot 提供（createTank 返回的 name），仅用于展示 */
  name: string;
  x: number;
  y: number;
  hp: number;
  dirBody: Dir;
  dirTurret: Dir;
  /** 剩余开火冷却 tick 数（每 tick 开始时减 1） */
  cooldown: number;
  alive: boolean;
  /** 累计违规（响应超时 / 代码抛异常 / 返回非法动作），达到上限判负。由 runner 维护。 */
  violations: number;
}

export interface Bullet {
  id: number;
  ownerId: 0 | 1;
  x: number;
  y: number;
  dir: Dir;
}

export type Winner = 0 | 1 | -1 | null; // null=未结束，-1=平局

export type EndReason =
  | null
  | 'destroyed' // 一方被击毁
  | 'maxTicks' // 打满回合数，按 HP 判定
  | 'violations' // 一方累计违规达上限
  | 'crash'; // 一方沙盒崩溃（死循环等）

export interface GameState {
  /** 使用的官方地图 id（复现用） */
  mapId: string;
  /** 本局规则数值快照（复现用） */
  rules: Rules;
  tick: number;
  tanks: [TankState, TankState];
  bullets: Bullet[];
  nextBulletId: number;
  finished: boolean;
  winner: Winner;
  endReason: EndReason;
}

export type GameEvent =
  | { type: 'fire'; tick: number; tankId: 0 | 1; x: number; y: number; dir: Dir }
  | { type: 'hit'; tick: number; bulletId: number; shooterId: 0 | 1; victimId: 0 | 1; x: number; y: number; damage: number; victimHp: number }
  | { type: 'bulletBlocked'; tick: number; bulletId: number; x: number; y: number } // 炮弹撞墙/障碍消失
  | { type: 'moveBlocked'; tick: number; tankId: 0 | 1; x: number; y: number } // 移动被阻挡（目标格不可进入）
  | { type: 'violation'; tick: number; tankId: 0 | 1; kind: 'timeout' | 'error' | 'invalidAction'; detail?: string }
  | { type: 'die'; tick: number; tankId: 0 | 1 }
  | { type: 'end'; tick: number; winner: Winner; reason: Exclude<EndReason, null> };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GameMap {
  id: string;
  name: string;
  width: number;
  height: number;
  /** 障碍矩形列表（格坐标） */
  obstacles: Rect[];
  /** 双方出生点，点对称 */
  spawns: [{ x: number; y: number; dir: Dir }, { x: number; y: number; dir: Dir }];
}

/** 全部规则数值。会原样写入回放文件，供复现与校验。 */
export interface Rules {
  fieldWidth: number;
  fieldHeight: number;
  maxHp: number;
  bulletDamage: number;
  bulletSpeed: number; // 每 tick 前进的格数（整数子步）
  fireCooldown: number; // 开火后需等待的 tick 数
  maxTicks: number;
  maxViolations: number; // 累计违规上限，达到即判负
  tickBudgetMs: number; // 每个 onTick 的响应时限（毫秒）
}

/** init 阶段（createTank(ctx)）传给 bot 的上下文，一次性提供。 */
export interface BotInitContext {
  field: { width: number; height: number };
  /** 障碍矩形列表（比赛中固定不变） */
  obstacles: Rect[];
  rules: Rules;
  /** 自己的坦克 id（0 或 1） */
  myId: 0 | 1;
  /** 引擎提供的确定性随机数发生器，[0,1) 浮点。禁止使用 Math.random（沙盒中会抛错）。 */
  rng: () => number;
}

/** 每 tick 传给 onTick 的只读战场快照（完全信息：双方都能看到全部单位）。 */
export interface BattleView {
  tick: number;
  field: { width: number; height: number };
  self: TankState;
  enemy: TankState;
  bullets: Bullet[];
  rules: Rules;
}
