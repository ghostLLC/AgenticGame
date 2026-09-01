import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppSettingsRepositoryV1 } from '../src/desktop/app-settings-repository-v1.js';
import { defaultAppSettingsV1 } from '../src/desktop/app-settings-v1.js';
import { SettingsServiceV1 } from '../src/desktop/settings-service-v1.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agentic-game-settings-service-'));
  roots.push(root);
  const run = vi.fn(async () => ({
    version: 1 as const, generatedAt: '2026-09-01T12:00:00.000Z',
    items: [{ id: 'version' as const, title: '游戏与协议', status: 'ok' as const, detail: '游戏版本 0.1.0 · 好友协议 v1' }],
  }));
  const importFrom = vi.fn(async () => ({ buildsImported: 2, replaysImported: 3, skipped: 1 }));
  const service = new SettingsServiceV1({
    settingsRepository: new AppSettingsRepositoryV1(root),
    diagnostics: { run },
    legacyImporter: { importFrom },
    chooseLegacyRoot: async () => 'D:\\OldAgenticGame',
    exportsRoot: join(root, 'exports'),
    openReleases: vi.fn(async () => undefined),
    appVersion: '0.1.0',
    now: () => '2026-09-01T12:00:00.000Z',
  });
  return { root, service, run, importFrom };
}

describe('SettingsServiceV1', () => {
  it('保存完整设置且绝不接受持久化密钥字段', async () => {
    const { service } = await fixture();
    const updated = { ...defaultAppSettingsV1(), masterVolume: 30, nearbyDiscovery: false };
    await expect(service.save(updated)).resolves.toEqual(updated);
    await expect(service.get()).resolves.toEqual(updated);
    await expect(service.save({ ...updated, apiKey: 'secret' } as never)).rejects.toThrow();
  });

  it('先声明诊断内容，再导出只有脱敏报告的原子 JSON', async () => {
    const { root, service, run } = await fixture();
    expect(service.diagnosticPreview()).toEqual({
      includes: ['游戏版本与协议', '数据读写', '比赛运行环境', '系统加密', '剪贴板', '附近好友', '异地直连'],
      excludes: ['API 密钥', 'Bot 源码', '完整邀请卡', '房间恢复信息', '文件路径'],
    });
    await expect(service.runDiagnostics()).resolves.toMatchObject({ version: 1 });
    await expect(service.exportDiagnostics()).resolves.toEqual({ fileName: 'AgenticGame-诊断-20260901T120000000Z.json' });
    expect(run).toHaveBeenCalledTimes(2);
    const source = await readFile(join(root, 'exports', 'AgenticGame-诊断-20260901T120000000Z.json'), 'utf8');
    expect(JSON.parse(source)).toMatchObject({ version: 1, appVersion: '0.1.0' });
    expect(source).not.toMatch(/apiKey|source|invitation|capsule|D:\\\\/i);
  });

  it('目录选择由主进程完成，取消不会传入路径', async () => {
    const { service, importFrom } = await fixture();
    await expect(service.importLegacy()).resolves.toEqual({ cancelled: false, buildsImported: 2, replaysImported: 3, skipped: 1 });
    expect(importFrom).toHaveBeenCalledWith('D:\\OldAgenticGame');

    const cancelled = new SettingsServiceV1({
      settingsRepository: { load: async () => defaultAppSettingsV1(), save: async () => undefined },
      diagnostics: { run: async () => ({ version: 1, generatedAt: '2026-09-01T12:00:00.000Z', items: [] }) },
      legacyImporter: { importFrom: vi.fn() }, chooseLegacyRoot: async () => null,
      exportsRoot: 'unused', openReleases: async () => undefined, appVersion: '0.1.0',
    });
    await expect(cancelled.importLegacy()).resolves.toEqual({ cancelled: true, buildsImported: 0, replaysImported: 0, skipped: 0 });
  });
});
