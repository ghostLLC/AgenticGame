import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runMatch } from '../src/runner/match.js';

describe('runMatch', () => {
  it('returns a loading-failure result for an invalid inline bot without a path', async () => {
    const opponentCode = readFileSync('bots/sitting-duck.js', 'utf8');

    const result = await runMatch({
      botA: { code: 'module.exports = 123;' },
      botB: { path: 'sitting-duck.js', code: opponentCode },
      maxTicks: 10,
    });

    expect(result.summary.winner).toBe(1);
    expect(result.summary.botNames[0]).toBe('inline');
    expect(result.summary.reason).toContain('加载失败');
    expect(result.replay.bots[0]?.file).toBe('inline');
  });

  it('produces identical battle frames for the same bots and seed', async () => {
    const chaserCode = readFileSync('bots/chaser.js', 'utf8');
    const targetCode = readFileSync('bots/sitting-duck.js', 'utf8');
    const config = {
      botA: { path: 'chaser.js', code: chaserCode },
      botB: { path: 'sitting-duck.js', code: targetCode },
      seed: 7,
      maxTicks: 120,
    };

    const first = await runMatch(config);
    const second = await runMatch(config);

    expect(second.summary).toEqual(first.summary);
    expect(second.replay.seeds).toEqual(first.replay.seeds);
    expect(second.replay.frames).toEqual(first.replay.frames);
  });

  it('ends the match when a bot blocks its worker with an infinite loop', async () => {
    const opponentCode = readFileSync('bots/sitting-duck.js', 'utf8');
    const blockingBot = `
      module.exports = function () {
        return { name: 'Blocking Bot', onTick() { while (true) {} } };
      };
    `;

    const result = await runMatch({
      botA: { code: blockingBot },
      botB: { path: 'sitting-duck.js', code: opponentCode },
      maxTicks: 20,
    });

    expect(result.summary.winner).toBe(1);
    expect(result.replay.result.reason).toBe('crash');
    expect(result.summary.reason).toContain('沙盒崩溃');
  });
});
