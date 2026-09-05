import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acquireWriteLease } from '../storage/write-lease.js';
import { mapLimited } from '../storage/map-limited.js';
import { cleanAbandonedTemps } from '../storage/quarantine-journal.js';
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
  modeName: string;
  mapId: string;
  teamNames: string[];
  teams: Array<{ teamId: string; displayName: string; codeHash: string; vehicleId: string; weaponId: string }>;
  winningTeamIds: string[];
  reason: string;
  ticks: number;
}

export type ReplayInspectionV2 =
  | { bundleHash: string; state: 'healthy'; entry: ReplayIndexEntryV2 }
  | { bundleHash: string; state: 'corrupt'; message: string };

export class ReplayRepositoryV2 {
  readonly root: string;
  // Verified summaries only, never executable input. Opening a replay always calls load().
  private readonly index = new Map<string, { identity: string; entry: ReplayIndexEntryV2 }>();

  constructor(root: string) {
    this.root = resolve(root);
  }

  async save(bundle: MatchBundleV2): Promise<ReplaySaveResultV2> {
    const candidate = structuredClone(assertVerifiedBundle(bundle));
    const bundleHash = candidate.integrity.bundleHash;
    validateBundleHash(bundleHash);
    await mkdir(this.root, { recursive: true });
    const lockPath = resolve(this.root, '.save.lock');
    const release = await acquireWriteLease(lockPath, 'Replay repository is busy');
    let temporaryPath: string | null = null;
    try {
      await cleanAbandonedTemps(this.root, /^\.[0-9a-f]{64}\.json\.tmp-[a-zA-Z0-9-]+$/);
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
      await release();
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
    const summaries = await mapLimited(hashes, 4, (bundleHash) => this.indexEntry(bundleHash));
    return summaries
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.bundleHash.localeCompare(b.bundleHash));
  }

  async inspect(): Promise<ReplayInspectionV2[]> {
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch (error) {
      if (isCode(error, 'ENOENT')) return [];
      throw error;
    }
    const hashes = entries.flatMap((entry) => {
      const match = /^([0-9a-f]{64})\.json$/.exec(entry);
      return match ? [match[1]!] : [];
    });
    const inspected = await mapLimited(hashes, 4, async (bundleHash): Promise<ReplayInspectionV2> => {
      try {
        return { bundleHash, state: 'healthy', entry: await this.indexEntry(bundleHash) };
      } catch {
        this.index.delete(bundleHash);
        return { bundleHash, state: 'corrupt', message: '回放未通过完整性校验' };
      }
    });
    const present = new Set(hashes);
    for (const hash of this.index.keys()) if (!present.has(hash)) this.index.delete(hash);
    return inspected.sort((a, b) => {
      if (a.state !== b.state) return a.state === 'corrupt' ? -1 : 1;
      if (a.state === 'healthy' && b.state === 'healthy') {
        return b.entry.createdAt.localeCompare(a.entry.createdAt) || a.bundleHash.localeCompare(b.bundleHash);
      }
      return a.bundleHash.localeCompare(b.bundleHash);
    });
  }

  filePath(bundleHash: string): string {
    validateBundleHash(bundleHash);
    return this.fileFor(bundleHash);
  }

  private fileFor(bundleHash: string): string {
    return resolve(this.root, `${bundleHash}.json`);
  }

  private async indexEntry(bundleHash: string): Promise<ReplayIndexEntryV2> {
    const source = await stat(this.fileFor(bundleHash));
    const identity = `${source.size}:${source.mtimeMs}:${source.ctimeMs}:${source.ino}`;
    const cached = this.index.get(bundleHash);
    if (cached?.identity === identity) return structuredClone(cached.entry);
    const entry = toIndexEntry(await this.load(bundleHash));
    // If the file changed during validation, don't associate it with the earlier identity.
    const after = await stat(this.fileFor(bundleHash));
    if (`${after.size}:${after.mtimeMs}:${after.ctimeMs}:${after.ino}` === identity) {
      this.index.delete(bundleHash);
      this.index.set(bundleHash, { identity, entry });
      if (this.index.size > 2000) this.index.delete(this.index.keys().next().value!);
    }
    return structuredClone(entry);
  }
}

function toIndexEntry(bundle: MatchBundleV2): ReplayIndexEntryV2 {
  return {
    bundleHash: bundle.integrity.bundleHash,
    matchId: bundle.config.matchId,
    createdAt: bundle.createdAt,
    engineVersion: bundle.engineVersion,
    modeId: bundle.config.modeId,
    modeName: bundle.contentSnapshot.modes.find((mode) => mode.id === bundle.config.modeId)?.displayName ?? bundle.config.modeId,
    mapId: bundle.config.mapId,
    teamNames: bundle.config.teams.map((team) => team.displayName),
    teams: bundle.config.teams.map((team) => ({ teamId: team.teamId, displayName: team.displayName,
      codeHash: team.bot.codeHash, vehicleId: team.loadout.vehicleId, weaponId: team.loadout.weaponIds[0]! })),
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
