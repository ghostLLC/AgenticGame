import type { Dir, Rules } from './types.js';

/** 方向表：索引 = Dir，值为 [dx, dy]。y 轴向下。 */
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // 0 N
  [1, -1], // 1 NE
  [1, 0], // 2 E
  [1, 1], // 3 SE
  [0, 1], // 4 S
  [-1, 1], // 5 SW
  [-1, 0], // 6 W
  [-1, -1], // 7 NW
];

export const DIR_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export const NUM_DIRS = 8;

export function dirDelta(dir: Dir): readonly [number, number] {
  const d = DIRS[dir]!;
  return d;
}

/** 转向：+1 顺时针 45°，-1 逆时针 45° */
export function turnDir(dir: Dir, delta: number): Dir {
  return (((dir + delta) % NUM_DIRS) + NUM_DIRS) % NUM_DIRS as Dir;
}

/** 两个方向之间的最短角差（-3..+3，顺时针为正） */
export function dirDiff(from: Dir, to: Dir): number {
  let d = (to - from) % NUM_DIRS;
  if (d > NUM_DIRS / 2) d -= NUM_DIRS;
  if (d < -NUM_DIRS / 2) d += NUM_DIRS;
  return d;
}

export const DEFAULT_RULES: Rules = {
  fieldWidth: 32,
  fieldHeight: 24,
  maxHp: 100,
  bulletDamage: 34,
  bulletSpeed: 2,
  fireCooldown: 4,
  maxTicks: 1500,
  maxViolations: 30,
  tickBudgetMs: 30,
};
