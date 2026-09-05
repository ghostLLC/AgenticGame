import type { MapSnapshotV2 } from '../core/v2/content.js';
import { GAMEPLAY_MAP_FRONTIER_V2 } from '../core/v2/gameplay-content.js';
import type { SavedBuildV2 } from '../config/saved-build-v2.js';
import { createPresetBuildV1 } from './preset-builds-v1.js';

export type EvaluationModeV1 = 'duel' | 'capture' | 'mixed';
export interface EvaluationCaseV1 {
  seed: number;
  candidateSeat: 0 | 1;
  modeId: 'duel' | 'capture';
  mapSnapshot: MapSnapshotV2;
  opponent: SavedBuildV2;
}
const HOLDOUT_SEEDS = [11, 29, 47, 71, 97, 131, 173, 211, 257, 307, 353, 401];
const OPEN_MAP: MapSnapshotV2 = {
  ...structuredClone(GAMEPLAY_MAP_FRONTIER_V2), id: 'open-training-v2', version: '1.0.0',
  terrainCells: GAMEPLAY_MAP_FRONTIER_V2.terrainCells.map((cell) => ({ ...cell, terrainId: 'open-ground' })),
};

export function createEvaluationPlanV1(depth: 'quick' | 'standard' | 'deep', mode: EvaluationModeV1, source: SavedBuildV2, now: string): EvaluationCaseV1[] {
  const count = depth === 'quick' ? 3 : depth === 'standard' ? 6 : 12;
  const opponents = [source, createPresetBuildV1('scout', now), createPresetBuildV1('heavy', now)];
  return Array.from({ length: count }, (_, index) => ([0, 1] as const).map((candidateSeat) => ({
    seed: HOLDOUT_SEEDS[index]!, candidateSeat,
    modeId: mode === 'mixed' ? (index % 2 ? 'capture' as const : 'duel' as const) : mode,
    mapSnapshot: structuredClone(index % 2 ? OPEN_MAP : GAMEPLAY_MAP_FRONTIER_V2),
    opponent: structuredClone(opponents[index % opponents.length]!),
  }))).flat();
}
