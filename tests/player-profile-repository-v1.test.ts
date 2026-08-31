import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlayerProfileV1 } from '../src/desktop/player-profile-v1.js';
import { PlayerProfileRepositoryV1 } from '../src/desktop/player-profile-repository-v1.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function repository(): Promise<{ root: string; repository: PlayerProfileRepositoryV1 }> {
  const root = await mkdtemp(join(tmpdir(), 'agentic-game-profile-'));
  roots.push(root);
  return { root, repository: new PlayerProfileRepositoryV1(root) };
}

const profile = () => createPlayerProfileV1({
  playerId: '11111111-1111-4111-8111-111111111111',
  displayName: '乐淳',
  doctrine: 'medium',
  now: '2026-08-31T10:00:00.000Z',
});

describe('PlayerProfileRepositoryV1', () => {
  it('把尚未创建档案视为首次启动', async () => {
    const { repository: repo } = await repository();
    await expect(repo.load()).resolves.toBeUndefined();
    await expect(repo.quarantineEntries()).resolves.toEqual([]);
  });

  it('原子保存并重新校验档案，不遗留临时文件', async () => {
    const { root, repository: repo } = await repository();
    const updated = { ...profile(), lastOpenedAt: '2026-08-31T10:05:00.000Z' };

    await repo.save(profile());
    await repo.save(updated);

    await expect(repo.load()).resolves.toEqual(updated);
    const profileDir = join(root, 'profile');
    expect(readdirSync(profileDir)).toEqual(['player-profile-v1.json']);
    expect(JSON.parse(readFileSync(join(profileDir, 'player-profile-v1.json'), 'utf8'))).toEqual(updated);
  });

  it.each([
    ['破损 JSON', '{"version":'],
    ['结构被篡改', JSON.stringify({ ...profile(), unexpected: true })],
  ])('隔离%s且不生成替代档案', async (_label, content) => {
    const { root, repository: repo } = await repository();
    const profileDir = join(root, 'profile');
    await mkdir(profileDir, { recursive: true });
    const profilePath = join(profileDir, 'player-profile-v1.json');
    writeFileSync(profilePath, content, 'utf8');

    await expect(repo.load()).rejects.toThrow('玩家档案已损坏，已移入隔离区');

    expect(existsSync(profilePath)).toBe(false);
    const entries = await repo.quarantineEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^player-profile-v1\.\d{8}T\d{6}\d{3}Z\.[0-9a-f-]+\.invalid\.json$/);
    expect(readFileSync(join(root, 'quarantine', entries[0]!), 'utf8')).toBe(content);
  });
});
