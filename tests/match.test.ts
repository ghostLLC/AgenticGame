import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyMatchBundleV2 } from '../src/replay/v2.js';
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
      // This assertion covers deterministic gameplay, not wall-clock timeout policy.
      // Keep the worker budget above parallel-suite scheduler jitter so timing noise
      // cannot become a replay violation.
      tickBudgetMs: 1_000,
      createdAt: '2026-08-24T00:00:00.000Z',
    };

    const first = await runMatch(config);
    const second = await runMatch(config);

    expect(second.summary).toEqual(first.summary);
    expect(second.replay.seeds).toEqual(first.replay.seeds);
    expect(second.replay.frames).toEqual(first.replay.frames);
    expect(second.bundle).toEqual(first.bundle);
  });

  it('emits a self-contained verified v2 bundle from the applied runtime timeline', async () => {
    const chaserCode = readFileSync('bots/chaser.js', 'utf8');
    const targetCode = readFileSync('bots/sitting-duck.js', 'utf8');

    const result = await runMatch({
      botA: { path: 'chaser.js', code: chaserCode },
      botB: { path: 'sitting-duck.js', code: targetCode },
      seed: 9,
      maxTicks: 40,
      createdAt: '2026-08-24T00:00:00.000Z',
      collectLogs: true,
    });

    expect(result.bundle.version).toBe(2);
    expect(result.bundle.botArtifacts.map((artifact) => artifact.source)).toEqual([chaserCode, targetCode]);
    expect(result.bundle.actions.length).toBeGreaterThan(0);
    expect(result.bundle.actions.slice(0, 2).map((record) => record.actorId)).toEqual(['team-a', 'team-b']);
    expect(result.bundle.checkpoints.length).toBe(result.replay.frames.length);
    expect(result.bundle.events.length).toBeGreaterThan(0);
    expect(verifyMatchBundleV2(result.bundle)).toEqual({ ok: true, issues: [] });
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
