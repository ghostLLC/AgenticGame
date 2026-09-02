import { describe, expect, it } from 'vitest';
import type { DesktopApiV1 } from '../src/desktop/desktop-api-v1.js';
import { AgentConnectorControllerV1 } from '../src/desktop/renderer/agent-connector-controller-v1.js';

const initial = {
  bridgeReady: true,
  privacy: '只增加游戏连接',
  hosts: [
    { id: 'codex' as const, name: 'Codex', summary: '持续改进', state: 'ready' as const },
    { id: 'workbuddy' as const, name: 'WorkBuddy', summary: '长期训练', state: 'not-found' as const },
    { id: 'qoder' as const, name: 'Qoder', summary: '快速迭代', state: 'needs-attention' as const },
  ],
};

describe('AgentConnectorControllerV1', () => {
  it('加载接入状态，并在一键接入后刷新为已连接', async () => {
    let connected = false;
    const api: DesktopApiV1['agentConnector'] = {
      inspect: async () => connected ? {
        ...initial,
        hosts: initial.hosts.map((host) => host.id === 'codex' ? { ...host, state: 'connected' as const } : host),
      } : initial,
      connect: async () => {
        connected = true;
        return { host: 'codex', configured: true, restartRequired: true, backupCreated: true, message: '已接入 Codex，请重启。' };
      },
    };
    const controller = new AgentConnectorControllerV1(api);

    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', connector: { bridgeReady: true } });
    await controller.connect('codex');
    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      notice: '已接入 Codex，请重启。',
    });
    expect(controller.getSnapshot().connector?.hosts).toContainEqual(
      expect.objectContaining({ id: 'codex', state: 'connected' }),
    );
  });

  it('连接进行中拒绝重复启动，并保留玩家可理解的错误', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const api: DesktopApiV1['agentConnector'] = {
      inspect: async () => initial,
      connect: async () => {
        calls += 1;
        await pending;
        throw new Error('Qoder 的连接配置需要先修复；游戏没有改动原配置');
      },
    };
    const controller = new AgentConnectorControllerV1(api);
    await controller.load();
    const first = controller.connect('qoder');
    await controller.connect('qoder');
    expect(controller.getSnapshot().status).toBe('connecting');
    expect(calls).toBe(1);
    release();
    await first;
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: 'Qoder 的连接配置需要先修复；游戏没有改动原配置' });
  });
});
