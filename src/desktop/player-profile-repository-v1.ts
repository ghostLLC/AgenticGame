import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPlayerProfileV1, type PlayerProfileV1 } from './player-profile-v1.js';
import { acquireWriteLease } from '../storage/write-lease.js';
import { writeAtomicJson } from '../storage/atomic-json.js';
import { cleanAbandonedTemps } from '../storage/quarantine-journal.js';

const PROFILE_FILE = 'player-profile-v1.json';

export class PlayerProfileRepositoryV1 {
  private readonly profileDirectory: string;
  private readonly profilePath: string;
  private readonly quarantineDirectory: string;
  private recoveryNotice?: string;

  constructor(private readonly root: string) {
    this.profileDirectory = join(root, 'profile');
    this.profilePath = join(this.profileDirectory, PROFILE_FILE);
    this.quarantineDirectory = join(root, 'quarantine');
  }

  async load(): Promise<PlayerProfileV1 | undefined> {
    let source: string | undefined;
    try {
      source = await readFile(this.profilePath, 'utf8');
    } catch (error) {
      if (!isMissing(error)) throw error;
    }

    try {
      if (source !== undefined) return assertPlayerProfileV1(JSON.parse(source));
    } catch {
      // Invalid records fall through to recovery. Missing records may have a valid backup.
    }
    await mkdir(this.profileDirectory, { recursive: true });
    const release = await acquireWriteLease(join(this.profileDirectory, '.profile.lock'));
    try {
        await cleanAbandonedTemps(this.profileDirectory, /^player-profile-v1\.json(?:\.[a-zA-Z0-9-]+\.tmp|(?:\.last-good)?\.tmp-[a-zA-Z0-9-]+)$/);
        let current: string | undefined;
        try { current = await readFile(this.profilePath, 'utf8'); } catch (error) { if (!isMissing(error)) throw error; }
        if (current !== undefined) {
          try { return assertPlayerProfileV1(JSON.parse(current)); } catch { /* preserve invalid bytes below */ }
          await this.quarantineInvalidProfile();
        }
        let backup: PlayerProfileV1;
        try { backup = assertPlayerProfileV1(JSON.parse(await readFile(`${this.profilePath}.last-good`, 'utf8'))); }
        catch (error) {
          if (typeof error === 'object' && error !== null && 'code' in error && !isMissing(error)) throw error;
          if ((await this.quarantineEntries()).some((entry) => entry.startsWith('player-profile-v1.'))) {
            this.recoveryNotice = '昵称档案已损坏并移入隔离区，请重新设置昵称；已有战术与回放仍保留。';
          }
          return undefined;
        }
        await writeAtomicJson(this.profilePath, backup);
        this.recoveryNotice = '昵称档案已从最近一次有效备份恢复；战术与回放不受影响。';
        return backup;
    } finally { await release(); }
  }

  takeRecoveryNotice(): string | undefined {
    const notice = this.recoveryNotice; this.recoveryNotice = undefined; return notice;
  }

  async save(input: PlayerProfileV1): Promise<void> {
    const profile = assertPlayerProfileV1(input);
    await mkdir(this.profileDirectory, { recursive: true });
    const release = await acquireWriteLease(join(this.profileDirectory, '.profile.lock'));
    try {
    await cleanAbandonedTemps(this.profileDirectory, /^player-profile-v1\.json(?:\.[a-zA-Z0-9-]+\.tmp|(?:\.last-good)?\.tmp-[a-zA-Z0-9-]+)$/);
    let backup = profile;
    try { backup = assertPlayerProfileV1(JSON.parse(await readFile(this.profilePath, 'utf8'))); } catch { /* first save or explicit replacement */ }
    await writeAtomicJson(`${this.profilePath}.last-good`, backup);
    await writeAtomicJson(this.profilePath, profile);
    } finally { await release(); }
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
