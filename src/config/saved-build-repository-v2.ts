import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acquireWriteLease } from '../storage/write-lease.js';
import { cleanAbandonedTemps, quarantineFiles, recoverQuarantine, recoverQuarantineIfPending } from '../storage/quarantine-journal.js';
import {
  assertSavedBuildV2,
  createSavedBuildV2,
  type SavedBuildDraftV2,
  type SavedBuildV2,
} from './saved-build-v2.js';

const STABLE_ID = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
let temporarySequence = 0;

export type SavedBuildRevisionInspectionV2 =
  | { revision: number; state: 'healthy'; record: SavedBuildV2 }
  | { revision: number; state: 'corrupt' | 'untrusted'; message: string };

export interface SavedBuildInspectionV2 {
  buildId: string;
  revisions: SavedBuildRevisionInspectionV2[];
  latestHealthy?: SavedBuildV2;
}

export interface SavedBuildQuarantineResultV2 {
  buildId: string;
  fromRevision: number;
  movedRevisions: number[];
  quarantineId: string;
}

export interface SavedBuildRepositoryOptionsV2 {
  quarantineRoot?: string;
  now?: () => string;
}

export interface SavedBuildSaveResultV2 {
  created: boolean;
  record: SavedBuildV2;
}

export interface SavedBuildSaveOptionsV2 {
  expectedRevision?: number;
  beforePublish?: (record: SavedBuildV2, created: boolean) => Promise<void>;
}

export class SavedBuildRepositoryV2 {
  readonly root: string;
  private readonly quarantineRoot?: string;
  private readonly now: () => string;

  constructor(root: string, options: SavedBuildRepositoryOptionsV2 = {}) {
    this.root = resolve(root);
    this.quarantineRoot = options.quarantineRoot === undefined ? undefined : resolve(options.quarantineRoot);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async save(draft: SavedBuildDraftV2, createdAt = new Date().toISOString(), options: SavedBuildSaveOptionsV2 = {}): Promise<SavedBuildSaveResultV2> {
    validateBuildId(draft.buildId);
    const directory = this.directoryFor(draft.buildId);
    await mkdir(directory, { recursive: true });
    const lockPath = resolve(directory, '.save.lock');
    const release = await acquireWriteLease(lockPath, `Saved Build is busy: ${draft.buildId}`);
    let temporaryPath: string | null = null;
    try {
      await recoverQuarantine(directory, this.quarantineParent(draft.buildId));
      await cleanAbandonedTemps(directory, /^\.\d+\.json\.tmp-[a-zA-Z0-9-]+$/);
      const history = await this.list(draft.buildId);
      const latest = history.at(-1);
      if (options.expectedRevision !== undefined && options.expectedRevision !== (latest?.revision ?? 0)) {
        throw new Error('战术版本已在其他窗口或 AI 中更新。请刷新并核对改动后重新保存；当前草稿已保留。');
      }
      const candidate = createSavedBuildV2(draft, {
        revision: (latest?.revision ?? 0) + 1,
        parentFingerprint: latest?.fingerprint ?? null,
        createdAt,
      });
      if (latest?.contentFingerprint === candidate.contentFingerprint) {
        await options.beforePublish?.(latest, false);
        return { created: false, record: latest };
      }

      const targetPath = this.fileFor(draft.buildId, candidate.revision);
      if (await exists(targetPath)) throw new Error(`Saved Build revision already exists: ${draft.buildId}@${candidate.revision}`);
      temporarySequence += 1;
      temporaryPath = resolve(directory, `.${candidate.revision}.json.tmp-${process.pid}-${temporarySequence}`);
      const temporary = await open(temporaryPath, 'wx');
      try {
        await temporary.writeFile(`${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
        await temporary.sync();
      } finally {
        await temporary.close();
      }
      await options.beforePublish?.(candidate, true);
      await rename(temporaryPath, targetPath);
      temporaryPath = null;
      return { created: true, record: candidate };
    } finally {
      await release();
      if (temporaryPath) {
        await unlink(temporaryPath).catch((error: unknown) => {
          if (!isCode(error, 'ENOENT')) throw error;
        });
      }
    }
  }

  async list(buildId: string): Promise<SavedBuildV2[]> {
    validateBuildId(buildId);
    const directory = this.directoryFor(buildId);
    await recoverQuarantineIfPending(directory, this.quarantineParent(buildId), '.save.lock');
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (isCode(error, 'ENOENT')) return [];
      throw error;
    }
    const revisionEntries = entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => {
        const match = /^(\d+)\.json$/.exec(entry);
        if (!match) throw new Error(`Unexpected Saved Build file: ${entry}`);
        return { entry, revision: Number(match[1]) };
      })
      .sort((a, b) => a.revision - b.revision);

    const records: SavedBuildV2[] = [];
    for (const [index, item] of revisionEntries.entries()) {
      const expectedRevision = index + 1;
      if (item.revision !== expectedRevision) throw new Error(`Saved Build revision gap: expected ${expectedRevision}`);
      const text = await readFile(resolve(directory, item.entry), 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new Error(`Invalid SavedBuildV2 JSON: ${buildId}@${item.revision}`);
      }
      const record = assertSavedBuildV2(parsed);
      if (record.buildId !== buildId || record.revision !== item.revision) {
        throw new Error(`Saved Build path mismatch: ${buildId}@${item.revision}`);
      }
      const expectedParent = records.at(-1)?.fingerprint ?? null;
      if (record.parentFingerprint !== expectedParent) {
        throw new Error(`Saved Build parent chain mismatch: ${buildId}@${item.revision}`);
      }
      records.push(record);
    }
    return records;
  }

  async load(buildId: string, revision: number | 'latest'): Promise<SavedBuildV2> {
    validateBuildId(buildId);
    if (revision !== 'latest' && (!Number.isSafeInteger(revision) || revision < 1)) {
      throw new Error(`Invalid revision: ${revision}`);
    }
    const records = await this.list(buildId);
    const record = revision === 'latest'
      ? records.at(-1)
      : records.find((item) => item.revision === revision);
    if (!record) throw new Error(`Saved Build not found: ${buildId}@${revision}`);
    return record;
  }

  async inspect(buildId: string): Promise<SavedBuildInspectionV2> {
    validateBuildId(buildId);
    await recoverQuarantineIfPending(this.directoryFor(buildId), this.quarantineParent(buildId), '.save.lock');
    const entries = await this.numericRevisionEntries(buildId);
    const revisions: SavedBuildRevisionInspectionV2[] = [];
    let latestHealthy: SavedBuildV2 | undefined;
    let blocked = false;
    let expectedRevision = 1;
    let expectedParent: string | null = null;
    for (const item of entries) {
      if (blocked) {
        revisions.push({
          revision: item.revision,
          state: 'untrusted',
          message: '前序版本已损坏，此版本的历史链无法验证。',
        });
        continue;
      }
      try {
        if (item.revision !== expectedRevision) {
          throw new Error(`Saved Build revision gap: expected ${expectedRevision}`);
        }
        const record = await this.readVerifiedRevision(buildId, item.entry, item.revision);
        if (record.parentFingerprint !== expectedParent) {
          throw new Error(`Saved Build parent chain mismatch: ${buildId}@${item.revision}`);
        }
        revisions.push({ revision: item.revision, state: 'healthy', record });
        latestHealthy = record;
        expectedRevision += 1;
        expectedParent = record.fingerprint;
      } catch {
        revisions.push({
          revision: item.revision,
          state: 'corrupt',
          message: '此版本未通过完整性校验，已禁止出战。',
        });
        blocked = true;
      }
    }
    return {
      buildId,
      revisions,
      ...(latestHealthy ? { latestHealthy } : {}),
    };
  }

  async quarantineFrom(buildId: string, revision: number): Promise<SavedBuildQuarantineResultV2> {
    validateBuildId(buildId);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error(`Invalid revision: ${revision}`);
    if (!this.quarantineRoot) throw new Error('Saved Build quarantine is not configured');
    const directory = this.directoryFor(buildId);
    const lockPath = resolve(directory, '.save.lock');
    const release = await acquireWriteLease(lockPath, `Saved Build is busy: ${buildId}`);
    try {
      await recoverQuarantine(directory, this.quarantineParent(buildId));
      const inspection = await this.inspect(buildId);
      const target = inspection.revisions.find((item) => item.revision === revision);
      if (!target || target.state !== 'corrupt') {
        throw new Error(`Saved Build revision is not a damaged chain root: ${buildId}@${revision}`);
      }
      const entries = (await this.numericRevisionEntries(buildId)).filter((item) => item.revision >= revision);
      const quarantineId = this.now().replace(/[:.]/g, '-');
      await quarantineFiles(directory, this.quarantineParent(buildId)!, quarantineId, entries.map((item) => item.entry));
      return {
        buildId,
        fromRevision: revision,
        movedRevisions: entries.map((item) => item.revision),
        quarantineId,
      };
    } finally {
      await release();
    }
  }

  private async numericRevisionEntries(buildId: string): Promise<Array<{ entry: string; revision: number }>> {
    const directory = this.directoryFor(buildId);
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (isCode(error, 'ENOENT')) return [];
      throw error;
    }
    return entries.flatMap((entry) => {
      const match = /^(\d+)\.json$/.exec(entry);
      return match ? [{ entry, revision: Number(match[1]) }] : [];
    }).sort((a, b) => a.revision - b.revision);
  }

  private async readVerifiedRevision(buildId: string, entry: string, revision: number): Promise<SavedBuildV2> {
    const text = await readFile(resolve(this.directoryFor(buildId), entry), 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Invalid SavedBuildV2 JSON: ${buildId}@${revision}`);
    }
    const record = assertSavedBuildV2(parsed);
    if (record.buildId !== buildId || record.revision !== revision) {
      throw new Error(`Saved Build path mismatch: ${buildId}@${revision}`);
    }
    return record;
  }

  private directoryFor(buildId: string): string {
    return resolve(this.root, buildId);
  }

  private quarantineParent(buildId: string): string | undefined {
    return this.quarantineRoot ? resolve(this.quarantineRoot, 'builds', buildId) : undefined;
  }

  private fileFor(buildId: string, revision: number): string {
    return resolve(this.directoryFor(buildId), `${revision}.json`);
  }
}

function validateBuildId(buildId: string): void {
  if (buildId.length < 1 || buildId.length > 64 || !STABLE_ID.test(buildId)) {
    throw new Error(`Invalid buildId: ${buildId}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (isCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
