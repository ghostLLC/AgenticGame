import { describe, expect, it } from 'vitest';
import type { DesktopApiV1 } from '../src/desktop/desktop-api-v1.js';
import { AgentCenterControllerV1 } from '../src/desktop/renderer/agent-center-controller-v1.js';

function api(): DesktopApiV1['agentCenter'] {
  return {
    get: async () => ({
      builds: [{ revision: 2, label: '中线突击', vehicleName: '中型坦克', weaponName: '中型炮' }],
      providerPresets: [{ id: 'openai', name: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', modelHint: '例如 gpt-5' }],
      evaluationDepths: [{ id: 'quick', name: '快速试跑', battles: 3 }],
    }),
    run: async () => ({
      status: 'completed', candidateId: 'candidate-1', sourceRevision: 2,
      evaluation: { battles: 3, wins: 2, draws: 1, losses: 0, winRate: 67, averageRemainingHp: 71, violations: 0, runtimeErrors: 0 },
      coachSummary: '已完成 3 场：2 胜、1 平、0 负。',
    }),
    cancel: async () => true,
    save: async () => ({ revision: 3, label: '抢点改进版' }),
  };
}

describe('AgentCenterControllerV1', () => {
  it('loads, runs and saves without retaining the key in its view state', async () => {
    const controller = new AgentCenterControllerV1(api());
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', center: { builds: [{ revision: 2 }] } });
    await controller.run({
      revision: 2,
      provider: { kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'model', apiKey: 'sk-session-only' },
      goal: '加强抢点', depth: 'quick',
    });
    expect(controller.getSnapshot()).toMatchObject({ status: 'result', result: { evaluation: { battles: 3, wins: 2 } } });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('sk-session-only');
    await controller.save({ label: '抢点改进版', note: '加强抢点' });
    expect(controller.getSnapshot()).toMatchObject({ status: 'saved', saved: { revision: 3 } });
  });

  it('supports cancelling and presents player-safe states', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const testApi = api();
    testApi.run = async () => {
      await pending;
      return { status: 'cancelled', candidateId: 'candidate-2', sourceRevision: 2, evaluation: { battles: 1, wins: 1, draws: 0, losses: 0, winRate: 100, averageRemainingHp: 90, violations: 0, runtimeErrors: 0 }, coachSummary: '已取消剩余评测。' };
    };
    const controller = new AgentCenterControllerV1(testApi);
    await controller.load();
    const running = controller.run({ revision: 2, provider: { kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'model', apiKey: 'key' }, goal: '测试取消', depth: 'quick' });
    expect(controller.getSnapshot().status).toBe('running');
    await controller.cancel();
    expect(controller.getSnapshot().status).toBe('cancelling');
    finish();
    await running;
    expect(controller.getSnapshot()).toMatchObject({ status: 'result', result: { status: 'cancelled' } });
  });
});
