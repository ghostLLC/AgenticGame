// 坦克竞技场 —— 回放文件格式
//
// 回放是自包含的：包含地图、规则、双方代码指纹、逐 tick 快照与事件。
// 任何人拿到回放都可以在本地引擎上验证其确定性与真实性。

import type { Bullet, EndReason, GameEvent, Rules, TankState, Winner } from '../core/types.js';

export interface ReplayFrame {
  tick: number;
  tanks: [TankState, TankState];
  bullets: Bullet[];
  events: GameEvent[];
  /** 双方本 tick 的 debug 日志（console.log 收集） */
  logs?: [string[], string[]];
}

export interface ReplayBotInfo {
  name: string;
  /** 参赛文件名（仅展示） */
  file: string;
  /** bot 源码 sha256 前 16 位（防篡改指纹） */
  codeHash: string;
  violations: number;
}

export interface Replay {
  format: 'tank-arena-replay';
  version: 1;
  engineVersion: string;
  createdAt: string;
  mapId: string;
  rules: Rules;
  /** 双方 RNG 种子（复现用） */
  seeds: [number, number];
  bots: [ReplayBotInfo, ReplayBotInfo];
  result: { winner: Winner; reason: Exclude<EndReason, null>; ticks: number };
  frames: ReplayFrame[];
}

export function snapshotTanks(tanks: readonly [TankState, TankState]): [TankState, TankState] {
  return [{ ...tanks[0]! }, { ...tanks[1]! }];
}

export function snapshotBullets(bullets: readonly Bullet[]): Bullet[] {
  return bullets.map((b) => ({ ...b }));
}
