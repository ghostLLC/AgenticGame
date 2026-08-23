import type { GameMap, Rect } from './types.js';

/** 计算矩形在 (W,H) 场地内的中心对称镜像矩形。用于保证地图点对称公平。 */
function mirrorRect(r: Rect, w: number, h: number): Rect {
  return { x: w - r.x - r.w, y: h - r.y - r.h, w: r.w, h: r.h };
}

/** 把一组"半场"矩形补全为中心对称的完整障碍列表。 */
function symmetrize(half: Rect[], w: number, h: number): Rect[] {
  const out: Rect[] = [];
  for (const r of half) {
    out.push(r);
    const m = mirrorRect(r, w, h);
    // 自对称的矩形（镜像等于自身）只放一次
    if (!(m.x === r.x && m.y === r.y)) out.push(m);
  }
  return out;
}

const W = 32;
const H = 24;

export const MAP_STANDARD: GameMap = {
  id: 'standard',
  name: '标准战场',
  width: W,
  height: H,
  obstacles: symmetrize(
    [
      { x: 15, y: 10, w: 2, h: 4 }, // 中央竖墙（自对称）
      { x: 7, y: 5, w: 3, h: 2 }, // 左上掩体
      { x: 7, y: 17, w: 3, h: 2 }, // 左下掩体
    ],
    W,
    H,
  ),
  spawns: [
    { x: 5, y: 12, dir: 2 }, // 西侧，朝东
    { x: 26, y: 11, dir: 6 }, // 东侧，朝西（点对称位）
  ],
};

export const MAP_PILLARS: GameMap = {
  id: 'pillars',
  name: '石柱阵',
  width: W,
  height: H,
  obstacles: symmetrize(
    [
      { x: 8, y: 5, w: 2, h: 2 },
      { x: 8, y: 17, w: 2, h: 2 },
      { x: 15, y: 11, w: 2, h: 2 }, // 中央柱（自对称）
    ],
    W,
    H,
  ),
  spawns: [
    { x: 16, y: 2, dir: 4 }, // 北侧，朝南
    { x: 15, y: 21, dir: 0 }, // 南侧，朝北（点对称位）
  ],
};

export const MAPS: Record<string, GameMap> = {
  [MAP_STANDARD.id]: MAP_STANDARD,
  [MAP_PILLARS.id]: MAP_PILLARS,
};

export function getMap(id: string): GameMap {
  const m = MAPS[id];
  if (!m) throw new Error(`未知地图: ${id}。可用地图: ${Object.keys(MAPS).join(', ')}`);
  return m;
}

/** 预计算障碍占据格，用于 engine 快速查询 */
export function buildObstacleGrid(map: GameMap): boolean[][] {
  const grid: boolean[][] = Array.from({ length: map.height }, () => Array<boolean>(map.width).fill(false));
  for (const r of map.obstacles) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        grid[y]![x] = true;
      }
    }
  }
  return grid;
}
