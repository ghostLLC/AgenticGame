import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertAppSettingsV1,
  type AppSettingsV1,
} from './app-settings-v1.js';
import type { LegacyImportResultV1 } from './legacy-data-import-service-v1.js';
import type { ReleaseDiagnosticReportV1 } from './release-diagnostics-service-v1.js';

export interface SettingsRepositoryPortV1 {
  load(): Promise<AppSettingsV1>;
  save(value: AppSettingsV1): Promise<void>;
}

export interface SettingsServiceOptionsV1 {
  settingsRepository: SettingsRepositoryPortV1;
  diagnostics: { run(): Promise<ReleaseDiagnosticReportV1> };
  legacyImporter: { importFrom(root: string): Promise<LegacyImportResultV1> };
  chooseLegacyRoot(): Promise<string | null>;
  exportsRoot: string;
  openReleases(): Promise<void>;
  appVersion: string;
  now?: () => string;
}

export interface DiagnosticPrivacyPreviewV1 {
  includes: string[];
  excludes: string[];
}

export interface LegacyImportProjectionV1 extends LegacyImportResultV1 { cancelled: boolean }

const PREVIEW: DiagnosticPrivacyPreviewV1 = {
  includes: ['游戏版本与协议', '数据读写', '比赛运行环境', '系统加密', '剪贴板', '附近好友', '异地直连'],
  excludes: ['API 密钥', 'Bot 源码', '完整邀请卡', '房间恢复信息', '文件路径'],
};

export class SettingsServiceV1 {
  private readonly now: () => string;

  constructor(private readonly options: SettingsServiceOptionsV1) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get(): Promise<AppSettingsV1> { return this.options.settingsRepository.load(); }

  async save(value: AppSettingsV1): Promise<AppSettingsV1> {
    const settings = assertAppSettingsV1(value);
    await this.options.settingsRepository.save(settings);
    return structuredClone(settings);
  }

  diagnosticPreview(): DiagnosticPrivacyPreviewV1 { return structuredClone(PREVIEW); }
  runDiagnostics(): Promise<ReleaseDiagnosticReportV1> { return this.options.diagnostics.run(); }

  async exportDiagnostics(): Promise<{ fileName: string }> {
    const generatedAt = canonicalInstant(this.now());
    const report = await this.options.diagnostics.run();
    const payload = {
      version: 1,
      generatedAt,
      appVersion: safeVersion(this.options.appVersion),
      report,
      privacy: { excluded: [...PREVIEW.excludes] },
    };
    await mkdir(this.options.exportsRoot, { recursive: true });
    const fileName = `AgenticGame-诊断-${generatedAt.replace(/[-:.]/g, '')}.json`;
    const target = join(this.options.exportsRoot, fileName);
    const temporary = join(this.options.exportsRoot, `.${fileName}.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    try { await rename(temporary, target); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
    return { fileName };
  }

  async importLegacy(): Promise<LegacyImportProjectionV1> {
    const root = await this.options.chooseLegacyRoot();
    if (!root) return { cancelled: true, buildsImported: 0, replaysImported: 0, skipped: 0 };
    return { cancelled: false, ...(await this.options.legacyImporter.importFrom(root)) };
  }

  openReleases(): Promise<void> { return this.options.openReleases(); }
}

function canonicalInstant(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return new Date(0).toISOString();
  return new Date(time).toISOString();
}

function safeVersion(value: string): string {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value) ? value : '未知';
}
