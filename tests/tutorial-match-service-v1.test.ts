import { describe, expect, it } from 'vitest';
import { runTutorialMatchV1 } from '../src/desktop/tutorial-match-service-v1.js';
import type { FriendRoomPresetIdV1 } from '../src/desktop/friend-room-runtime-v1.js';

describe('真实教学比赛 v1', () => {
  it.each<FriendRoomPresetIdV1>(['scout', 'medium', 'heavy'])(
    '使用 %s 入门战术运行真实比赛并只返回玩家公开回放',
    async (doctrine) => {
      const result = await runTutorialMatchV1({
        doctrine,
        displayName: '乐淳',
        now: '2026-08-31T10:00:00.000Z',
      });

      expect(result.replay.frames.length).toBeGreaterThan(1);
      expect(result.replay.participants).toHaveLength(2);
      expect(result.replay.participants[0]?.displayName).toContain('乐淳');
      expect(result.winningTeamIds).toEqual(result.replay.result.winningTeamIds);
      expect(result.lessons.length).toBeGreaterThanOrEqual(1);
      expect(result.lessons.length).toBeLessThanOrEqual(3);
      expect(result.lessons.every((lesson) => lesson.title.length > 0 && lesson.detail.length > 0)).toBe(true);

      const publicOutput = JSON.stringify(result);
      expect(publicOutput).not.toMatch(/module\.exports|codeHash|bundleHash|actions|debugLogs|[0-9a-f]{64}/);
      expect(publicOutput).not.toMatch(/tickBudget|seed|JSON|源码|哈希/);
    },
  );
});
