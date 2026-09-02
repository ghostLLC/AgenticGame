import type { AppSettingsV1 } from '../app-settings-v1.js';
import type { DesktopApiV1 } from '../desktop-api-v1.js';
import type { DiagnosticPrivacyPreviewV1 } from '../settings-service-v1.js';
import type { ReleaseDiagnosticReportV1 } from '../release-diagnostics-service-v1.js';

type SettingsApiV1 = DesktopApiV1['settings'];

export interface SettingsControllerSnapshotV1 {
  status: 'idle' | 'loading' | 'ready' | 'working' | 'error';
  settings?: AppSettingsV1;
  preview?: DiagnosticPrivacyPreviewV1;
  diagnostics?: ReleaseDiagnosticReportV1;
  notice?: string;
  error?: string;
}

export class SettingsControllerV1 {
  private snapshot: SettingsControllerSnapshotV1 = { status: 'idle' };
  private listeners = new Set<(snapshot: SettingsControllerSnapshotV1) => void>();

  constructor(private readonly api: SettingsApiV1) {}

  subscribe(listener: (snapshot: SettingsControllerSnapshotV1) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    this.set({ status: 'loading' });
    try {
      const [settings, preview] = await Promise.all([this.api.get(), this.api.diagnosticPreview()]);
      this.set({ status: 'ready', settings, preview });
    } catch (error) { this.fail(error); }
  }

  async save(settings: AppSettingsV1): Promise<void> {
    const previous = this.snapshot;
    this.set({ ...previous, status: 'working', notice: undefined, error: undefined });
    try {
      const saved = await this.api.save(settings);
      this.set({ ...previous, status: 'ready', settings: saved, notice: '设置已保存' });
    } catch (error) { this.fail(error, previous); }
  }

  async runDiagnostics(): Promise<void> {
    await this.work(async () => ({ diagnostics: await this.api.runDiagnostics(), notice: '检查完成' }));
  }

  async exportDiagnostics(): Promise<void> {
    await this.work(async () => {
      const result = await this.api.exportDiagnostics();
      return { notice: `诊断报告已保存：${result.fileName}` };
    });
  }

  async importLegacy(): Promise<void> {
    await this.work(async () => {
      const result = await this.api.importLegacy();
      if (result.cancelled) return { notice: '已取消导入' };
      return { notice: `已导入 ${result.buildsImported} 个战术版本和 ${result.replaysImported} 场经典回放；${result.skipped} 项未通过安全检查。` };
    });
  }

  openReleases(): Promise<void> { return this.api.openReleases(); }
  getSnapshot(): SettingsControllerSnapshotV1 { return structuredClone(this.snapshot); }

  private async work(action: () => Promise<Partial<SettingsControllerSnapshotV1>>): Promise<void> {
    const previous = this.snapshot;
    this.set({ ...previous, status: 'working', notice: undefined, error: undefined });
    try { this.set({ ...previous, ...(await action()), status: 'ready' }); }
    catch (error) { this.fail(error, previous); }
  }

  private fail(error: unknown, previous: SettingsControllerSnapshotV1 = {} as SettingsControllerSnapshotV1): void {
    this.set({ ...previous, status: 'error', error: error instanceof Error ? error.message : '操作失败，请重试' });
  }

  private set(snapshot: SettingsControllerSnapshotV1): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(this.getSnapshot());
  }
}
