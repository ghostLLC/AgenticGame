import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SavedBuildRepositoryV2 } from '../src/config/saved-build-repository-v2.js';
import { BuildRevisionNoteRepositoryV1 } from '../src/desktop/build-revision-note-repository-v1.js';
import { AgentCenterServiceV1 } from '../src/desktop/agent-center-service-v1.js';
import type { AgentModelProviderV1 } from '../src/agent/harness-v1.js';

const roots: string[] = [];
const baseSource = 'module.exports = () => ({ onTick() { return { throttle: 0, fire: false }; } });';
const candidateSource = 'module.exports = () => ({ onTick() { return { throttle: 1, fire: true }; } });';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agent-center-v1-'));
  roots.push(root);
  const builds = new SavedBuildRepositoryV2(join(root, 'builds'));
  const notes = new BuildRevisionNoteRepositoryV1(join(root, 'notes'));
  await builds.save({
    buildId: 'commander-main', label: '中线突击',
    bot: { artifactId: 'commander-main-bot', version: '1.0.0', language: 'javascript', entryPoint: 'commander-main.js', source: baseSource },
    loadout: { vehicleId: 'medium', weaponId: 'medium-cannon', equipmentIds: [] },
  }, '2026-09-01T00:00:00.000Z');
  await notes.save({ version: 1, buildId: 'commander-main', revision: 1, tacticId: 'medium', note: '初始版本', createdAt: '2026-09-01T00:00:00.000Z' });
  return { builds, notes };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function candidateProvider(secret: string): AgentModelProviderV1 {
  let turn = 0;
  return {
    id: 'fake',
    redactSensitiveText: (value) => value.split(secret).join('[REDACTED]'),
    async complete() {
      turn += 1;
      return turn === 1
        ? { content: `using ${secret}`, toolCalls: [{ id: 'candidate-1', name: 'evaluate_bot', arguments: { source: candidateSource } }] }
        : { content: `done ${secret}` };
    },
  };
}

describe('AgentCenterServiceV1', () => {
  it('runs paired 6/12/24 battle evaluations and stores private reproducible evidence', async () => {
    const { builds, notes } = await fixture();
    const seenSeeds: number[] = [];
    const service = new AgentCenterServiceV1({
      buildRepository: builds,
      noteRepository: notes,
      providerFactory: (config) => {
        expect(config.apiKey).toBe('sk-private');
        return candidateProvider(config.apiKey);
      },
      toolsFactory: () => [{
        name: 'evaluate_bot', description: 'evaluate', inputSchema: { type: 'object' },
        execute: async () => ({ verified: true }),
      }],
      matrixRunner: async ({ seed }) => {
        seenSeeds.push(seed);
        const index = seenSeeds.length;
        return { outcome: index % 3 === 1 ? 'win' : index % 3 === 2 ? 'draw' : 'loss', hp: 80 - index, violations: index % 2 };
      },
      createCandidateId: () => 'candidate-session-1',
      now: () => '2026-09-01T12:00:00.000Z',
    });

    const snapshot = await service.getSnapshot();
    expect(snapshot.builds).toEqual([expect.objectContaining({ revision: 1, label: '中线突击', vehicleName: '中型坦克' })]);
    expect(snapshot.providerPresets.map((item) => item.id)).toEqual(['openai', 'deepseek', 'anthropic', 'custom']);

    for (const [depth, expected] of [['quick', 6], ['standard', 12], ['deep', 24]] as const) {
      seenSeeds.length = 0;
      const result = await service.run({
        revision: 1, provider: { kind: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'model-x', apiKey: 'sk-private' },
        goal: '更积极抢点，但不要侧面对敌', depth,
      });
      expect(seenSeeds).toHaveLength(expected);
      expect(new Set(seenSeeds).size).toBe(expected / 2);
      expect(result.evaluationMode).toBe('capture');
      const evidence = JSON.parse(await readFile(join(builds.root, '..', 'evaluations', result.evidenceFileName!), 'utf8'));
      expect(evidence.rows).toHaveLength(expected);
      expect(new Set(evidence.rows.map((row: {candidateSeat:number}) => row.candidateSeat))).toEqual(new Set([0, 1]));
      expect(evidence.rows.every((row: {modeId:string}) => row.modeId === 'capture')).toBe(true);
      expect(evidence.opponents).toHaveLength(3);
      expect(evidence.maps).toHaveLength(2);
      expect(evidence.candidate.botArtifact.source).toBe(candidateSource);
      expect(JSON.stringify(evidence)).not.toMatch(/sk-private|provider\.example/);
      expect(result).toMatchObject({ status: 'completed', candidateId: 'candidate-session-1', evaluation: { battles: expected } });
      const projection = JSON.stringify(result);
      expect(projection).not.toMatch(/sk-private|provider\.example|module\.exports|candidateSource|seed|transcript|toolCall|codeHash/i);
    }
  });

  it('keeps a candidate session-only until an explicit save creates a new immutable revision', async () => {
    const { builds, notes } = await fixture();
    const service = new AgentCenterServiceV1({
      buildRepository: builds, noteRepository: notes,
      providerFactory: (config) => candidateProvider(config.apiKey),
      toolsFactory: () => [{ name: 'evaluate_bot', description: 'evaluate', inputSchema: {}, execute: async () => ({ ok: true }) }],
      matrixRunner: async () => ({ outcome: 'win', hp: 75, violations: 0 }),
      createCandidateId: () => 'candidate-session-2', now: () => '2026-09-01T12:00:00.000Z',
    });
    const result = await service.run({
      revision: 1, provider: { kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-test', apiKey: 'ant-private' },
      goal: '守住正面并及时开火', depth: 'quick',
    });
    expect((await builds.list('commander-main'))).toHaveLength(1);
    await expect(service.saveCandidate({ candidateId: result.candidateId, label: 'AI 调整版', note: '提高正面压制', confirmed: false as true }))
      .rejects.toThrow('需要明确确认');
    const saved = await service.saveCandidate({ candidateId: result.candidateId, label: 'AI 调整版', note: '提高正面压制', confirmed: true });
    expect(saved).toEqual({ revision: 2, label: 'AI 调整版' });
    expect((await builds.load('commander-main', 2)).botArtifact.source).toBe(candidateSource);
    expect((await notes.list('commander-main')).at(-1)).toMatchObject({ revision: 2, tacticId: 'medium', note: '提高正面压制' });
    await expect(service.saveCandidate({ candidateId: result.candidateId, label: '重复', note: '', confirmed: true }))
      .rejects.toThrow('候选方案已保存或已失效');
  });

  it('cancels remaining battles, preserves completed results, and never saves implicitly', async () => {
    const { builds, notes } = await fixture();
    let runs = 0;
    let service!: AgentCenterServiceV1;
    service = new AgentCenterServiceV1({
      buildRepository: builds, noteRepository: notes,
      providerFactory: (config) => candidateProvider(config.apiKey),
      toolsFactory: () => [{ name: 'evaluate_bot', description: 'evaluate', inputSchema: {}, execute: async () => ({ ok: true }) }],
      matrixRunner: async ({ signal }) => {
        runs += 1;
        if (runs === 1) return { outcome: 'win', hp: 88, violations: 0 };
        queueMicrotask(() => service.cancel());
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        return { outcome: 'loss', hp: 0, violations: 1 };
      },
      createCandidateId: () => 'candidate-session-3',
    });
    const result = await service.run({
      revision: 1, provider: { kind: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'model', apiKey: 'key' },
      goal: '测试取消', depth: 'deep',
    });
    expect(result).toMatchObject({ status: 'cancelled', evaluation: { battles: 1, wins: 1 } });
    expect(await builds.list('commander-main')).toHaveLength(1);
    expect(service.cancel()).toBe(false);
  });

  it('runs the production quick matrix through the real Gameplay v2 worker sandbox', async () => {
    const { builds, notes } = await fixture();
    const service = new AgentCenterServiceV1({
      buildRepository: builds,
      noteRepository: notes,
      providerFactory: (config) => candidateProvider(config.apiKey),
      toolsFactory: () => [{ name: 'evaluate_bot', description: 'evaluate', inputSchema: {}, execute: async () => ({ verified: true }) }],
      createCandidateId: () => 'real-matrix-candidate',
      now: () => '2026-09-01T12:00:00.000Z',
    });
    const result = await service.run({
      revision: 1,
      provider: { kind: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'model', apiKey: 'key' },
      goal: '验证真实比赛路径',
      depth: 'quick',
    });
    expect(result.status).toBe('completed');
    expect(result.evaluation.battles).toBe(6);
    expect(result.evaluation.wins + result.evaluation.draws + result.evaluation.losses).toBe(6);
    expect(result.evaluation.runtimeErrors).toBe(0);
  }, 30_000);
});
