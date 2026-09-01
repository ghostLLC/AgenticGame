import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertAppSettingsV1,
  defaultAppSettingsV1,
} from '../src/desktop/app-settings-v1.js';
import { AppSettingsRepositoryV1 } from '../src/desktop/app-settings-repository-v1.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'agentic-game-settings-'));
  roots.push(root);
  return { root, repository: new AppSettingsRepositoryV1(root) };
}

describe('AppSettingsV1', () => {
  it('提供不包含密钥的玩家默认设置', () => {
    expect(defaultAppSettingsV1()).toEqual({
      version: 1,
      language: 'zh-CN',
      masterVolume: 80,
      effectsVolume: 75,
      motion: 'full',
      nearbyDiscovery: true,
      defaultFriendMode: 'nearby',
      recentProvider: null,
      advancedOpen: false,
    });
    expect(JSON.stringify(defaultAppSettingsV1())).not.toMatch(/key|secret|token/i);
  });

  it('严格拒绝未知字段、越界音量和带凭据的 provider 地址', () => {
    expect(() => assertAppSettingsV1({ ...defaultAppSettingsV1(), extra: true })).toThrow();
    expect(() => assertAppSettingsV1({ ...defaultAppSettingsV1(), masterVolume: 101 })).toThrow();
    expect(() => assertAppSettingsV1({
      ...defaultAppSettingsV1(),
      recentProvider: { kind: 'openai-compatible', baseUrl: 'https://name:secret@example.com/v1', model: 'x' },
    })).toThrow();
  });
});

describe('AppSettingsRepositoryV1', () => {
  it('首次启动返回默认设置，保存后原子回读', async () => {
    const { root, repository: repo } = await repository();
    await expect(repo.load()).resolves.toEqual(defaultAppSettingsV1());
    const updated = { ...defaultAppSettingsV1(), masterVolume: 45, motion: 'reduced' as const };
    await repo.save(updated);
    await expect(repo.load()).resolves.toEqual(updated);
    expect(await readdir(join(root, 'settings'))).toEqual(['app-settings-v1.json']);
  });

  it('隔离损坏设置并安全返回默认值', async () => {
    const { root, repository: repo } = await repository();
    await mkdir(join(root, 'settings'), { recursive: true });
    const path = join(root, 'settings', 'app-settings-v1.json');
    writeFileSync(path, '{"version":', 'utf8');

    await expect(repo.load()).resolves.toEqual(defaultAppSettingsV1());
    expect(existsSync(path)).toBe(false);
    const entries = await readdir(join(root, 'quarantine'));
    expect(entries).toHaveLength(1);
    expect(readFileSync(join(root, 'quarantine', entries[0]!), 'utf8')).toBe('{"version":');
  });
});
