import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BuildRevisionNoteRepositoryV1,
  assertBuildRevisionNoteV1,
  type BuildRevisionNoteV1,
} from '../src/desktop/build-revision-note-repository-v1.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(): { root: string; repository: BuildRevisionNoteRepositoryV1 } {
  const root = mkdtempSync(join(tmpdir(), 'agentic-game-build-notes-'));
  roots.push(root);
  return {
    root,
    repository: new BuildRevisionNoteRepositoryV1(root, {
      quarantineRoot: join(root, 'quarantine'),
      now: () => '2026-09-01T01:02:03.000Z',
    }),
  };
}

function note(revision = 1): BuildRevisionNoteV1 {
  return {
    version: 1,
    buildId: 'commander-main',
    revision,
    tacticId: revision === 1 ? 'medium' : 'scout',
    note: revision === 1 ? '初始战术' : '提高侧翼机动性',
    createdAt: `2026-09-01T00:0${revision}:00.000Z`,
  };
}

describe('BuildRevisionNoteRepositoryV1', () => {
  it('atomically saves strict revision notes and lists them in revision order', async () => {
    const { root, repository: repo } = repository();

    await repo.save(note(2));
    await repo.save(note(1));

    expect(await repo.load('commander-main', 1)).toEqual(note(1));
    expect(await repo.list('commander-main')).toEqual([note(1), note(2)]);
    expect(readdirSync(join(root, 'commander-main')).sort()).toEqual(['1.json', '2.json']);
    expect(readFileSync(join(root, 'commander-main', '1.json'), 'utf8')).not.toContain('提高侧翼机动性');
  });

  it('rejects overwrite, traversal and invalid player text before persistence', async () => {
    const { repository: repo } = repository();
    await repo.save(note(1));

    await expect(repo.save(note(1))).rejects.toThrow('already exists');
    await expect(repo.load('../outside', 1)).rejects.toThrow('Invalid buildId');
    await expect(repo.save({ ...note(2), note: 'x'.repeat(241) })).rejects.toThrow('Invalid BuildRevisionNoteV1');
    await expect(repo.save({ ...note(2), note: ' 未修剪 ' })).rejects.toThrow('Invalid BuildRevisionNoteV1');
  });

  it('fails closed on unknown keys and tampered persisted notes', async () => {
    expect(() => assertBuildRevisionNoteV1({ ...note(1), source: 'secret' })).toThrow('unknown fields');
    const { root, repository: repo } = repository();
    await repo.save(note(1));
    writeFileSync(join(root, 'commander-main', '1.json'), JSON.stringify({ ...note(1), tacticId: 'sniper' }), 'utf8');

    await expect(repo.load('commander-main', 1)).rejects.toThrow('Invalid BuildRevisionNoteV1');
  });

  it('quarantines notes from a damaged revision without deleting their bytes', async () => {
    const { root, repository: repo } = repository();
    await repo.save(note(1));
    await repo.save(note(2));
    const original = readFileSync(join(root, 'commander-main', '2.json'), 'utf8');

    const result = await repo.quarantineFrom('commander-main', 2);

    expect(result).toEqual({ fromRevision: 2, movedRevisions: [2], quarantineId: '2026-09-01T01-02-03-000Z' });
    expect(await repo.list('commander-main')).toEqual([note(1)]);
    expect(readFileSync(join(root, 'quarantine', 'build-notes', 'commander-main', result.quarantineId, '2.json'), 'utf8'))
      .toBe(original);
  });
});
