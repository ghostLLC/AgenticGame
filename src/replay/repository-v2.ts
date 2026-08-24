import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyMatchBundleV2, type MatchBundleV2 } from './v2.js';

const SHA256 = /^[0-9a-f]{64}$/;
let temporarySequence = 0;

export interface ReplaySaveResultV2 {
  created: boolean;
  bundle: MatchBundleV2;
}

export interface ReplayIndexEntryV2 {
  bundleHash: string;
  matchId: string;
  createdAt: string;
  engineVersion: string;
  modeId: string;
  mapId: string;
  teamNames: string[];
  winningTeamIds: string[];
  reason: string;
  ticks: number;
}

export class ReplayRepositoryV2 {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async save(bundle: MatchBundleV2): Promise<ReplaySaveResultV2> {
    const candidate = structuredClone(assertVerifiedBundle(bundle));
    const bundleHash = candidate.integrity.bundleHash;
    validateBundleHash(bundleHash);
    await mkdir(this.root, { recursive: true });
    const lockPath = resolve(this.root, '.save.lock');
    const lock = await open(lockPath, 'wx').catch((error: unknown) => {
      if (isCode(error, 'EEXIST')) throw new Error('Replay repository is busy');
      throw error;
    });
    let temporaryPath: string | null = null;
    try {
      const targetPath = this.fileFor(bundleHash);
      if (await exists(targetPath)) {
        return { created: false, bundle: await this.load(bundleHash) };
      }

      temporarySequence += 1;
      temporaryPath = resolve(this.root, `.${bundleHash}.json.tmp-${process.pid}-${temporarySequence}`);
      const temporary = await open(temporaryPath, 'wx');
      try {
        await temporary.writeFile(`${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
        await temporary.sync();
      } finally {
        await temporary.close();
      }
      await rename(temporaryPath, targetPath);
      temporaryPath = null;
      return { created: true, bundle: candidate };
    } finally {
      await lock.close();
      await unlink(lockPath).catch((error: unknown) => {
        if (!isCode(error, 'ENOENT')) throw error;
      });
      if (temporaryPath) {
        await unlink(temporaryPath).catch((error: unknown) => {
          if (!isCode(error, 'ENOENT')) throw error;
        });
      }
    }
  }

  async load(bundleHash: string): Promise<MatchBundleV2> {
    validateBundleHash(bundleHash);
    let text: string;
    try {
      text = await readFile(this.fileFor(bundleHash), 'utf8');
    } catch (error) {
      if (isCode(error, 'ENOENT')) throw new Error(`Replay not found: ${bundleHash}`);
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Invalid MatchBundleV2 JSON: ${bundleHash}`);
    }
    const bundle = assertVerifiedBundle(parsed, bundleHash);
    if (bundle.integrity.bundleHash !== bundleHash) {
      throw new Error(`Replay path mismatch: ${bundleHash}`);
    }
    return bundle;
  }

  async list(): Promise<ReplayIndexEntryV2[]> {
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch (error) {
      if (isCode(error, 'ENOENT')) return [];
      throw error;
    }

    const hashes = entries.flatMap((entry) => {
      if (!entry.endsWith('.json')) return [];
      const bundleHash = entry.slice(0, -'.json'.length);
      if (!SHA256.test(bundleHash)) throw new Error(`Unexpected Replay file: ${entry}`);
      return [bundleHash];
    });
    const bundles = await Promise.all(hashes.map((bundleHash) => this.load(bundleHash)));
    return bundles
      .map(toIndexEntry)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.bundleHash.localeCompare(b.bundleHash));
  }

  private fileFor(bundleHash: string): string {
    return resolve(this.root, `${bundleHash}.json`);
  }
}

function toIndexEntry(bundle: MatchBundleV2): ReplayIndexEntryV2 {
  return {
    bundleHash: bundle.integrity.bundleHash,
    matchId: bundle.config.matchId,
    createdAt: bundle.createdAt,
    engineVersion: bundle.engineVersion,
    modeId: bundle.config.modeId,
    mapId: bundle.config.mapId,
    teamNames: bundle.config.teams.map((team) => team.displayName),
    winningTeamIds: [...bundle.result.winningTeamIds],
    reason: bundle.result.reason,
    ticks: bundle.result.ticks,
  };
}

function assertVerifiedBundle(value: unknown, label = 'input'): MatchBundleV2 {
  try {
    if (!isRecord(value)
      || !isRecord(value.integrity)
      || !isRecord(value.config)
      || !isRecord(value.mapSnapshot)
      || !isRecord(value.contentSnapshot)
      || !isRecord(value.result)
      || !Array.isArray(value.botArtifacts)
      || !Array.isArray(value.actions)
      || !Array.isArray(value.events)
      || !Array.isArray(value.checkpoints)
      || !Array.isArray(value.logs)) {
      throw new Error('missing required structure');
    }
    const bundle = value as unknown as MatchBundleV2;
    const verification = verifyMatchBundleV2(bundle);
    if (!verification.ok) throw new Error(verification.issues.map((issue) => issue.code).join(', '));
    return bundle;
  } catch (error) {
    throw new Error(`Invalid MatchBundleV2: ${label}`, { cause: error });
  }
}

function validateBundleHash(bundleHash: string): void {
  if (!SHA256.test(bundleHash)) throw new Error(`Invalid bundle hash: ${bundleHash}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
