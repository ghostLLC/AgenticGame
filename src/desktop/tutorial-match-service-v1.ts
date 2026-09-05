import {
  GAMEPLAY_CONTENT_V2,
} from '../core/v2/gameplay-content.js';
import type { MapSnapshotV2 } from '../core/v2/content.js';
import { runPracticeMatchV2 } from '../practice/run-practice-match-v2.js';
import { createFriendRoomReplayV1, type FriendRoomReplayV1 } from '../friend-room/replay-v1.js';
import type { ReplayStudioMomentV2 } from '../replay/studio-v2.js';
import { createPresetBuildV1, type FriendRoomPresetIdV1 } from './preset-builds-v1.js';

export interface TutorialMatchInputV1 {
  doctrine: FriendRoomPresetIdV1;
  displayName: string;
  now?: string;
}

export interface TutorialLessonV1 {
  title: string;
  detail: string;
}

export interface TutorialMatchResultV1 {
  replay: FriendRoomReplayV1;
  winningTeamIds: string[];
  lessons: TutorialLessonV1[];
}

const TUTORIAL_MAP: MapSnapshotV2 = {
  id: 'training-ground-v2', version: '1.0.0', width: 12, height: 9,
  terrainCells: Array.from({ length: 108 }, (_, index) => ({ x: index % 12, y: Math.floor(index / 12), terrainId: 'open-ground' })),
  spawnPoints: [
    { id: 'west', x: 2, y: 2, bodyDirection: 2, turretDirection: 2 },
    { id: 'east', x: 9, y: 6, bodyDirection: 6, turretDirection: 6 },
  ],
};

export async function runTutorialMatchV1(input: TutorialMatchInputV1): Promise<TutorialMatchResultV1> {
  const now = input.now ?? new Date().toISOString();
  const current = createPresetBuildV1(input.doctrine, now, input.displayName);
  const opponent = createPresetBuildV1('heavy', now, '训练对手');
  const output = await runPracticeMatchV2({
    current,
    opponent,
    contentSnapshot: GAMEPLAY_CONTENT_V2,
    mapSnapshot: TUTORIAL_MAP,
    seed: 314159,
    maxTicks: 80,
    createdAt: now,
    tickBudgetMs: 100,
    collectLogs: false,
  });
  const replay = createFriendRoomReplayV1(output.bundle);
  return {
    replay,
    winningTeamIds: [...output.summary.winningTeamIds],
    lessons: selectLessons(replay.moments),
  };
}

function selectLessons(moments: ReplayStudioMomentV2[]): TutorialLessonV1[] {
  const lessons: TutorialLessonV1[] = [];
  const used = new Set<string>();
  for (const moment of moments) {
    const lesson = momentLesson(moment);
    if (!lesson || used.has(moment.kind)) continue;
    used.add(moment.kind);
    lessons.push(lesson);
    if (lessons.length === 3) break;
  }
  return lessons.length > 0
    ? lessons
    : [{ title: '先观察，再行动', detail: '留意敌车位置、射界和目标区域，再决定推进方向。' }];
}

function momentLesson(moment: ReplayStudioMomentV2): TutorialLessonV1 | null {
  if (moment.kind === 'damage') return { title: '注意装甲方向', detail: moment.summary };
  if (moment.kind === 'destruction') return { title: '抓住歼灭窗口', detail: moment.summary };
  if (moment.kind === 'objective') return { title: '持续控制目标区', detail: moment.summary };
  if (moment.kind === 'result') return { title: '复盘胜负原因', detail: moment.summary };
  return null;
}
