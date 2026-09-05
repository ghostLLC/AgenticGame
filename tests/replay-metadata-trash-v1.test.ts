import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ReplayMetadataRepositoryV1,
  assertReplayMetadataV1,
} from '../src/desktop/replay-metadata-repository-v1.js';
import { ReplayTrashRepositoryV1 } from '../src/desktop/replay-trash-repository-v1.js';

const roots: string[] = [];
const replayId = 'a'.repeat(64);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'agentic-game-replay-storage-'));
  roots.push(value);
  return value;
}

describe('ReplayMetadataRepositoryV1', () => {
  it('validates exact player notes and atomically replaces an existing note', async () => {
    const base = root();
    const repository = new ReplayMetadataRepositoryV1(join(base, 'metadata'));
    const first = {
      version: 1 as const, replayId, note: '第一次复盘',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    };
    await repository.save(first);
    await repository.save({ ...first, note: '找到侧翼窗口', updatedAt: '2026-09-01T00:01:00.000Z' });

    expect(await repository.load(replayId)).toEqual({ ...first, note: '找到侧翼窗口', updatedAt: '2026-09-01T00:01:00.000Z' });
    expect(await repository.list()).toHaveLength(1);
    expect(() => assertReplayMetadataV1({ ...first, note: ' 尾随空格' })).toThrow('Invalid ReplayMetadataV1');
    expect(() => assertReplayMetadataV1({ ...first, extra: true })).toThrow('Invalid ReplayMetadataV1');
    expect(() => assertReplayMetadataV1({ ...first, replayId: '../escape' })).toThrow('Invalid ReplayMetadataV1');
  });
});

describe('ReplayTrashRepositoryV1', () => {
  it.each([0, 1, 2])('resumes interrupted move and restore after %i file moves', async (completed) => {
    const base = root();
    const entryId = `practice-${replayId}`;
    const entry = { version: 1, entryId, replayId, source: 'practice', deletedAt: '2026-09-01T00:00:00.000Z', hasMetadata: true };
    const paths = [`replays/${replayId}.json`, `metadata/${replayId}.json`];
    const directory = join(base, 'trash', 'entries', entryId);
    const transaction = join(base, 'trash', 'transactions', `${entryId}.json`);
    mkdirSync(directory, { recursive: true });
    mkdirSync(join(base, 'trash', 'transactions'), { recursive: true });
    paths.forEach((path, index) => {
      mkdirSync(join(base, path, '..'), { recursive: true });
      writeFileSync(join(base, path), `original bytes ${index}`);
    });
    writeFileSync(transaction, JSON.stringify({ version: 1, direction: 'move', entry, replayPath: paths[0], metadataPath: paths[1] }));
    const names = ['replay.json', 'metadata.json'];
    for (let index = 0; index < completed; index++) renameSync(join(base, paths[index]!), join(directory, names[index]!));
    expect(await new ReplayTrashRepositoryV1(join(base, 'trash')).list()).toEqual([entry]);
    writeFileSync(transaction, JSON.stringify({ version: 1, direction: 'restore', entry, replayPath: paths[0], metadataPath: paths[1] }));
    for (let index = 0; index < completed; index++) renameSync(join(directory, names[index]!), join(base, paths[index]!));
    expect(await new ReplayTrashRepositoryV1(join(base, 'trash')).list()).toEqual([]);
    paths.forEach((path, index) => expect(readFileSync(join(base, path), 'utf8')).toBe(`original bytes ${index}`));
    expect(existsSync(transaction)).toBe(false);
  });

  it('isolates unreadable entries and unsafe transactions without deleting their bytes', async () => {
    const base = root();
    const entryId = `practice-${replayId}`;
    const directory = join(base, 'trash', 'entries', entryId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'entry.json'), '{');
    writeFileSync(join(directory, 'replay.json'), 'preserved');
    const repository = new ReplayTrashRepositoryV1(join(base, 'trash'));
    expect(await repository.inspect()).toEqual({ entries: [], damagedCount: 1 });
    expect(await repository.empty(true)).toEqual([]);
    expect(readFileSync(join(directory, 'replay.json'), 'utf8')).toBe('preserved');
    const entry = { version: 1, entryId, replayId, source: 'practice', deletedAt: '2026-09-01T00:00:00.000Z', hasMetadata: false };
    writeFileSync(join(base, 'trash', 'transactions', `${entryId}.json`), JSON.stringify({ version: 1, direction: 'restore', entry, replayPath: `../outside/${replayId}.json` }));
    expect(await repository.inspect()).toEqual({ entries: [], damagedCount: 1 });
    expect(readFileSync(join(directory, 'replay.json'), 'utf8')).toBe('preserved');
  });

  it('moves exact replay and metadata bytes to trash and restores them without data loss', async () => {
    const base = root();
    const replayPath = join(base, 'replays', `${replayId}.json`);
    const metadataPath = join(base, 'metadata', `${replayId}.json`);
    mkdirSync(join(base, 'replays'), { recursive: true });
    mkdirSync(join(base, 'metadata'), { recursive: true });
    writeFileSync(replayPath, 'verified replay bytes\n', 'utf8');
    writeFileSync(metadataPath, 'player note bytes\n', 'utf8');
    const repository = new ReplayTrashRepositoryV1(join(base, 'trash'), {
      now: () => '2026-09-01T02:00:00.000Z',
    });

    const moved = await repository.move({ replayId, source: 'practice', replayPath, metadataPath });

    expect(existsSync(replayPath)).toBe(false);
    expect(existsSync(metadataPath)).toBe(false);
    expect(await repository.list()).toEqual([expect.objectContaining({
      entryId: `practice-${replayId}`, replayId, source: 'practice', deletedAt: '2026-09-01T02:00:00.000Z', hasMetadata: true,
    })]);
    await repository.restore(moved.entryId, { replayPath, metadataPath });
    expect(readFileSync(replayPath, 'utf8')).toBe('verified replay bytes\n');
    expect(readFileSync(metadataPath, 'utf8')).toBe('player note bytes\n');
    expect(await repository.list()).toEqual([]);
  });

  it('rejects restore collisions and only purges entries after seven full days', async () => {
    const base = root();
    const replayPath = join(base, 'replays', `${replayId}.json`);
    mkdirSync(join(base, 'replays'), { recursive: true });
    writeFileSync(replayPath, 'replay', 'utf8');
    const repository = new ReplayTrashRepositoryV1(join(base, 'trash'), {
      now: () => '2026-09-01T00:00:00.000Z',
    });
    const moved = await repository.move({ replayId, source: 'practice', replayPath });
    mkdirSync(join(base, 'replays'), { recursive: true });
    writeFileSync(replayPath, 'collision', 'utf8');

    await expect(repository.restore(moved.entryId, { replayPath })).rejects.toThrow('already exists');
    expect(await repository.purgeExpired('2026-09-07T23:59:59.999Z')).toEqual([]);
    expect(await repository.purgeExpired('2026-09-08T00:00:00.000Z')).toEqual([moved.entryId]);
    expect(await repository.list()).toEqual([]);
  });

  it('empties only validated trash entries after explicit confirmation', async () => {
    const base = root();
    const repository = new ReplayTrashRepositoryV1(join(base, 'trash'));
    const replayPath = join(base, 'public', `${replayId}.json`);
    mkdirSync(join(base, 'public'), { recursive: true });
    writeFileSync(replayPath, 'public replay', 'utf8');
    await repository.move({ replayId, source: 'friend-public', replayPath });

    await expect(repository.empty(false)).rejects.toThrow('confirmation');
    expect(await repository.empty(true)).toEqual([`friend-public-${replayId}`]);
    expect(await repository.list()).toEqual([]);
  });
});
