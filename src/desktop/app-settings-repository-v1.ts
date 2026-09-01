import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertAppSettingsV1,
  defaultAppSettingsV1,
  type AppSettingsV1,
} from './app-settings-v1.js';

const FILE = 'app-settings-v1.json';

export class AppSettingsRepositoryV1 {
  private readonly directory: string;
  private readonly path: string;
  private readonly quarantine: string;

  constructor(root: string) {
    this.directory = join(root, 'settings');
    this.path = join(this.directory, FILE);
    this.quarantine = join(root, 'quarantine');
  }

  async load(): Promise<AppSettingsV1> {
    let source: string;
    try { source = await readFile(this.path, 'utf8'); }
    catch (error) {
      if (isMissing(error)) return defaultAppSettingsV1();
      throw error;
    }
    try { return assertAppSettingsV1(JSON.parse(source)); }
    catch {
      await mkdir(this.quarantine, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:.]/g, '');
      await rename(this.path, join(this.quarantine, `app-settings-v1.${stamp}.${randomUUID()}.invalid.json`));
      return defaultAppSettingsV1();
    }
  }

  async save(value: AppSettingsV1): Promise<void> {
    const settings = assertAppSettingsV1(value);
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `${FILE}.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    try { await rename(temporary, this.path); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
