import { describe, expect, it, vi } from 'vitest';
import { defaultAppSettingsV1 } from '../src/desktop/app-settings-v1.js';
import { SettingsControllerV1 } from '../src/desktop/renderer/settings-controller-v1.js';

function api() {
  const settings = defaultAppSettingsV1();
  return {
    get: vi.fn(async () => settings),
    save: vi.fn(async (input) => input),
    diagnosticPreview: vi.fn(async () => ({ includes: ['数据读写'], excludes: ['API 密钥'] })),
    runDiagnostics: vi.fn(async () => ({ version: 1 as const, generatedAt: '2026-09-01T12:00:00.000Z', items: [
      { id: 'data' as const, title: '本地战绩与配置', status: 'ok' as const, detail: '正常' },
    ] })),
    exportDiagnostics: vi.fn(async () => ({ fileName: 'diagnostic.json' })),
    importLegacy: vi.fn(async () => ({ cancelled: false, buildsImported: 1, replaysImported: 2, skipped: 3 })),
    openReleases: vi.fn(async () => undefined),
  };
}

describe('SettingsControllerV1', () => {
  it('加载、保存设置并保留诊断隐私说明', async () => {
    const port = api();
    const controller = new SettingsControllerV1(port);
    await controller.load();
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', settings: { masterVolume: 80 }, preview: { excludes: ['API 密钥'] } });
    await controller.save({ ...defaultAppSettingsV1(), masterVolume: 35, motion: 'reduced' });
    expect(controller.getSnapshot()).toMatchObject({ settings: { masterVolume: 35, motion: 'reduced' }, notice: '设置已保存' });
  });

  it('运行检查、导出报告与导入旧数据时只呈现玩家化结果', async () => {
    const controller = new SettingsControllerV1(api());
    await controller.load();
    await controller.runDiagnostics();
    expect(controller.getSnapshot()).toMatchObject({ diagnostics: { items: [{ status: 'ok' }] } });
    await controller.exportDiagnostics();
    expect(controller.getSnapshot().notice).toBe('诊断报告已保存：diagnostic.json');
    await controller.importLegacy();
    expect(controller.getSnapshot().notice).toBe('已导入 1 个战术版本和 2 场经典回放；3 项未通过安全检查。');
  });
});
