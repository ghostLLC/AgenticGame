import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

export type GarageTacticIdV1 = 'scout' | 'medium' | 'heavy';

export interface BuildRevisionNoteV1 {
  version: 1;
  buildId: string;
  revision: number;
  tacticId: GarageTacticIdV1;
  note: string;
  createdAt: string;
}

const KEYS = ['version', 'buildId', 'revision', 'tacticId', 'note', 'createdAt'] as const;
const STABLE_ID = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const TACTICS = new Set<GarageTacticIdV1>(['scout', 'medium', 'heavy']);
const QUARANTINE_ID = /^[0-9TZ-]+$/;
let temporarySequence = 0;

export interface BuildRevisionNoteRepositoryOptionsV1 {
  quarantineRoot?: string;
  now?: () => string;
}

export interface BuildRevisionNoteQuarantineResultV1 {
  fromRevision: number;
  movedRevisions: number[];
  quarantineId: string;
}

export function assertBuildRevisionNoteV1(input: unknown): BuildRevisionNoteV1 {
  if (!isRecord(input)) throw invalid('record');
  const keys = Object.keys(input);
  if (keys.length !== KEYS.length || keys.some((key) => !KEYS.includes(key as typeof KEYS[number]))) {
    throw invalid('unknown fields');
  }
  if (input.version !== 1) throw invalid('version');
  if (typeof input.buildId !== 'string' || input.buildId.length > 64 || !STABLE_ID.test(input.buildId)) {
    throw invalid('buildId');
  }
  if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw invalid('revision');
  }
  if (typeof input.tacticId !== 'string' || !TACTICS.has(input.tacticId as GarageTacticIdV1)) {
    throw invalid('tacticId');
  }
  if (typeof input.note !== 'string' || input.note !== input.note.trim() || [...input.note].length > 240) {
    throw invalid('note');
  }
  if (typeof input.createdAt !== 'string'
    || Number.isNaN(Date.parse(input.createdAt))
    || new Date(input.createdAt).toISOString() !== input.createdAt) {
    throw invalid('createdAt');
  }
  return structuredClone(input) as unknown as BuildRevisionNoteV1;
}

export class BuildRevisionNoteRepositoryV1 {
  readonly root: string;
  private readonly quarantineRoot?: string;
  private readonly now: () => string;

  constructor(root: string, options: BuildRevisionNoteRepositoryOptionsV1 = {}) {
    this.root = resolve(root);
    this.quarantineRoot = options.quarantineRoot === undefined ? undefined : resolve(options.quarantineRoot);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async save(input: BuildRevisionNoteV1): Promise<BuildRevisionNoteV1> {
    const note = assertBuildRevisionNoteV1(input);
    const directory = this.directoryFor(note.buildId);
    await mkdir(directory, { recursive: true });
    const lockPath = resolve(directory, '.notes.lock');
    const lock = await open(lockPath, 'wx').catch((error: unknown) => {
      if (isCode(error, 'EEXIST')) throw new Error(`Build revision notes are busy: ${note.buildId}`);
      throw error;
    });
    let temporaryPath: string | undefined;
    try {
      const targetPath = this.fileFor(note.buildId, note.revision);
      if (await exists(targetPath)) throw new Error(`Build revision note already exists: ${note.buildId}@${note.revision}`);
      temporarySequence += 1;
      temporaryPath = resolve(directory, `.${note.revision}.json.tmp-${process.pid}-${temporarySequence}`);
      const temporary = await open(temporaryPath, 'wx');
      try {
        await temporary.writeFile(`${JSON.stringify(note, null, 2)}\n`, 'utf8');
        await temporary.sync();
      } finally {
        await temporary.close();
      }
      await rename(temporaryPath, targetPath);
      temporaryPath = undefined;
      return structuredClone(note);
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

  async load(buildId: string, revision: number): Promise<BuildRevisionNoteV1> {
    validateLocation(buildId, revision);
    let text: string;
    try {
      text = await readFile(this.fileFor(buildId, revision), 'utf8');
    } catch (error) {
      if (isCode(error, 'ENOENT')) throw new Error(`Build revision note not found: ${buildId}@${revision}`);
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Invalid BuildRevisionNoteV1 JSON: ${buildId}@${revision}`);
    }
    const note = assertBuildRevisionNoteV1(parsed);
    if (note.buildId !== buildId || note.revision !== revision) {
      throw new Error(`Build revision note path mismatch: ${buildId}@${revision}`);
    }
    return note;
  }

  async list(buildId: string): Promise<BuildRevisionNoteV1[]> {
    validateBuildId(buildId);
    let entries: string[];
    try {
      entries = await readdir(this.directoryFor(buildId));
    } catch (error) {
      if (isCode(error, 'ENOENT')) return [];
      throw error;
    }
    const revisions = entries.flatMap((entry) => {
      if (!entry.endsWith('.json')) return [];
      const match = /^(\d+)\.json$/.exec(entry);
      if (!match) throw new Error(`Unexpected Build revision note file: ${entry}`);
      return [Number(match[1])];
    }).sort((a, b) => a - b);
    return Promise.all(revisions.map((revision) => this.load(buildId, revision)));
  }

  async quarantineFrom(
    buildId: string,
    revision: number,
    requestedQuarantineId?: string,
  ): Promise<BuildRevisionNoteQuarantineResultV1> {
    validateLocation(buildId, revision);
    if (!this.quarantineRoot) throw new Error('Build revision note quarantine is not configured');
    const quarantineId = requestedQuarantineId ?? this.now().replace(/[:.]/g, '-');
    if (!QUARANTINE_ID.test(quarantineId)) throw new Error('Invalid quarantineId');
    const directory = this.directoryFor(buildId);
    const lockPath = resolve(directory, '.notes.lock');
    const lock = await open(lockPath, 'wx').catch((error: unknown) => {
      if (isCode(error, 'EEXIST')) throw new Error(`Build revision notes are busy: ${buildId}`);
      throw error;
    });
    const moved: Array<{ revision: number; source: string; destination: string }> = [];
    try {
      const entries = await readdir(directory);
      const revisions = entries.flatMap((entry) => {
        const match = /^(\d+)\.json$/.exec(entry);
        return match && Number(match[1]) >= revision ? [{ entry, revision: Number(match[1]) }] : [];
      }).sort((a, b) => a.revision - b.revision);
      const parent = resolve(this.quarantineRoot, 'build-notes', buildId);
      const destinationRoot = resolve(parent, quarantineId);
      await mkdir(parent, { recursive: true });
      await mkdir(destinationRoot);
      try {
        for (const item of revisions) {
          const source = resolve(directory, item.entry);
          const destination = resolve(destinationRoot, item.entry);
          await rename(source, destination);
          moved.push({ revision: item.revision, source, destination });
        }
      } catch (error) {
        for (const item of [...moved].reverse()) await rename(item.destination, item.source);
        throw error;
      }
      return { fromRevision: revision, movedRevisions: moved.map((item) => item.revision), quarantineId };
    } finally {
      await lock.close();
      await unlink(lockPath).catch((error: unknown) => {
        if (!isCode(error, 'ENOENT')) throw error;
      });
    }
  }

  private directoryFor(buildId: string): string {
    validateBuildId(buildId);
    return resolve(this.root, buildId);
  }

  private fileFor(buildId: string, revision: number): string {
    validateLocation(buildId, revision);
    return resolve(this.directoryFor(buildId), `${revision}.json`);
  }
}

function validateLocation(buildId: string, revision: number): void {
  validateBuildId(buildId);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error(`Invalid revision: ${revision}`);
}

function validateBuildId(buildId: string): void {
  if (buildId.length < 1 || buildId.length > 64 || !STABLE_ID.test(buildId)) {
    throw new Error(`Invalid buildId: ${buildId}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function invalid(issue: string): Error {
  return new Error(`Invalid BuildRevisionNoteV1: ${issue}`);
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
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === code;
}
