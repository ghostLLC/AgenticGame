import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ReleaseDiagnosticsServiceV1,
  probeUdpLoopbackV1,
  probeWritableDirectoryV1,
} from '../src/desktop/release-diagnostics-service-v1.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('ReleaseDiagnosticsServiceV1', () => {
  it('用玩家语言检查七项发布边界，并诚实说明无 TURN 的公网限制', async () => {
    const service = new ReleaseDiagnosticsServiceV1({
      dataProbe: async () => true,
      sandboxProbe: async () => true,
      encryptionAvailable: () => true,
      clipboardAvailable: () => true,
      lanProbe: async () => true,
      stunProbe: async () => false,
      version: '0.1.0',
      now: () => '2026-09-01T12:00:00.000Z',
    });

    const report = await service.run();

    expect(report.generatedAt).toBe('2026-09-01T12:00:00.000Z');
    expect(report.items.map((item) => item.id)).toEqual([
      'data', 'sandbox', 'encryption', 'clipboard', 'lan', 'stun', 'version',
    ]);
    expect(report.items.find((item) => item.id === 'stun')).toMatchObject({
      status: 'warning',
      detail: expect.stringMatching(/公网|中继|严格 NAT/),
    });
    expect(report.items.find((item) => item.id === 'version')).toMatchObject({ status: 'ok', detail: '游戏版本 0.1.0 · 好友协议 v1' });
  });

  it('探针失败只产生安全状态，不回显异常、密钥、源码、完整邀请或恢复密文', async () => {
    const service = new ReleaseDiagnosticsServiceV1({
      dataProbe: async () => { throw new Error('sk-secret AGFR2.full-offer module.exports ciphertext'); },
      sandboxProbe: async () => false,
      encryptionAvailable: () => false,
      clipboardAvailable: () => false,
      lanProbe: async () => false,
      stunProbe: async () => false,
      version: '0.1.0',
    });

    const report = await service.run();
    const serialized = JSON.stringify(report);

    expect(report.items.find((item) => item.id === 'data')?.status).toBe('error');
    expect(report.items.find((item) => item.id === 'encryption')).toMatchObject({
      status: 'warning', detail: expect.stringMatching(/不会明文保存/),
    });
    expect(serialized).not.toMatch(/sk-secret|AGFR2|module\.exports|ciphertext|stack|path/i);
  });

  it('真实检查数据目录原子读写与 UDP localhost 回环', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentic-game-diagnostics-'));
    roots.push(root);

    await expect(probeWritableDirectoryV1(root)).resolves.toBe(true);
    await expect(probeUdpLoopbackV1()).resolves.toBe(true);
  });
});
