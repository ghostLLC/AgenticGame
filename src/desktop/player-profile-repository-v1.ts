import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPlayerProfileV1, type PlayerProfileV1 } from './player-profile-v1.js';

const PROFILE_FILE = 'player-profile-v1.json';

export class PlayerProfileRepositoryV1 {
  private readonly profileDirectory: string;
  private readonly profilePath: string;
  private readonly quarantineDirectory: string;

  constructor(private readonly root: string) {
    this.profileDirectory = join(root, 'profile');
    this.profilePath = join(this.profileDirectory, PROFILE_FILE);
    this.quarantineDirectory = join(root, 'quarantine');
  }

  async load(): Promise<PlayerProfileV1 | undefined> {
    let source: string;
    try {
      source = await readFile(this.profilePath, 'utf8');
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }

    try {
      return assertPlayerProfileV1(JSON.parse(source));
    } catch {
      await this.quarantineInvalidProfile();
      throw new Error('玩家档案已损坏，已移入隔离区');
    }
  }

  async save(input: PlayerProfileV1): Promise<void> {
    const profile = assertPlayerProfileV1(input);
    await mkdir(this.profileDirectory, { recursive: true });
    const temporaryPath = join(this.profileDirectory, `${PROFILE_FILE}.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(profile, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(temporaryPath, this.profilePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async quarantineEntries(): Promise<string[]> {
    try {
      return (await readdir(this.quarantineDirectory)).sort();
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  private async quarantineInvalidProfile(): Promise<void> {
    await mkdir(this.quarantineDirectory, { recursive: true });
    await access(this.profilePath, constants.F_OK);
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
    const target = join(
      this.quarantineDirectory,
      `player-profile-v1.${timestamp}.${randomUUID()}.invalid.json`,
    );
    await rename(this.profilePath, target);
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
